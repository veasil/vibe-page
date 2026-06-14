// ============================================================
// generate.mjs — 生成编排（/api/generate 的核心）
// 流程：验权 → 命中缓存则直返(零成本) → 查配额 → 组 prompt →
//       调 LLM → 展开宏 → 包壳 → setIfAbsent 锁定 → 计量 → 返回
// 安全/成本红线全部在这一条链上落地。
// ============================================================
import * as kv from "./kv.mjs";
import * as llm from "./llm.mjs";
import { buildMessages, sanitizeSlug, GEN_PARAMS } from "./prompt.mjs";
import { expandMacros } from "./macros.mjs";
import { renderShell } from "./shell.mjs";
import { findBlocked } from "./blocklist.mjs";
import * as egg from "./egg.mjs";

// 上游 LLM 调用失败的结构化错误（网络/欠费/认证/限流）——由 llm.mjs 抛出，经此层冒泡到 route 分类响应。
export { UpstreamError } from "./llm.mjs";

export class QuotaError extends Error {
  constructor(q){ super(`今日生成配额已用尽（${q.used}/${q.max}）`); this.name = "QuotaError"; this.status = 429; this.quota = q; }
}

// 命中关键词黑名单（UGC 止血）：输入或生成内容涉违规，拒绝生成/封存。
export class BlockedError extends Error {
  constructor(where){ super("该内容涉及违规已被拦截"); this.name = "BlockedError"; this.status = 451; this.where = where; }
}

// 模型撞 max_tokens 被截断，页面不完整——绝不能写入 KV（协商真实=首写即永久锁定）。
export class TruncationError extends Error {
  constructor(){ super("生成内容被截断（max_tokens），已丢弃未写入，请重试"); this.name = "TruncationError"; this.status = 502; }
}

function keyFor(task){
  if (task.type === "home") return "home";
  if (task.type === "page") return "page:" + sanitizeSlug(task.path);
  return null; // search 不缓存
}

/**
 * 生成（或命中缓存返回）一个页面。
 * @param {object} task  { type, path?, query? }
 * @param {object} user  已通过 requireUser 的用户 { id }
 * @returns {Promise<{html, cached, key, usage?, costUsd?, quota?}>}
 */
export async function generatePage(task, user){
  const key = keyFor(task);

  // 0) UGC 止血：输入(slug/query)命中黑名单 → 直接拒绝，不查缓存不生成不扣费
  const input = task.type === "page" ? task.path : task.type === "search" ? task.query : "";
  if (findBlocked(input)) throw new BlockedError("input");

  // 0.5) 彩蛋层：本期生效彩蛋命中 → 记发现 + 返回彩蛋页（覆盖普通页，不查缓存不扣配额）
  if (task.type === "page" || task.type === "search"){
    const active = await egg.getEgg();
    if (active && egg.matchEgg(input, active)){
      const period = egg.currentPeriod();
      const found = await egg.markFound(period, user.id);
      const html = egg.renderEggPage(active, { rank: found.count, already: found.already });
      return { html, cached: false, key: null, egg: true, eggFound: found };
    }
  }

  // 1) 命中缓存：纯 KV 读，零成本，不消耗配额（协商真实）
  if (key){
    const cached = await kv.get(key);
    if (cached) return { html: cached, cached: true, key };
  }

  // 2) 需要真正生成 → 先扣配额（防刷随机路径烧 token）
  const quota = await kv.consumeQuota(user.id);
  if (!quota.ok) throw new QuotaError(quota);

  // 3) 组 prompt（注入已存档词条做自引用）
  const existingSlugs = await kv.archivedSlugs();
  const messages = buildMessages({ ...task, existingSlugs });

  // 4) 调 LLM（mock 或 DeepSeek）
  const { text, usage, finishReason } = await llm.generate(messages, GEN_PARAMS);

  // 4.1) 计量：token 一旦被上游消费就已计费，无论后续是否截断/拦截/写入。
  //      因此在任何丢弃分支之前先记账，确保 admin 统计与 provider 控制台对得上
  //      （之前只在成功写入后才 bump，导致失败/截断的真实花费在 admin 里“凭空消失”）。
  const costUsd = llm.estCostUsd(usage);
  if (!usage.mock){
    meter({ userId: user.id, key, usage, costUsd, finishReason });
    kv.bumpGenStats({
      inTok: usage.input || 0, outTok: usage.output || 0,
      costMicro: Math.round(costUsd * 1e6),
    }).catch(() => {});
  }

  // 4.5) 被截断 → 页面不完整，退还配额并丢弃，绝不写入 KV（否则坏页被永久锁定）
  if (finishReason === "length"){
    await kv.refundQuota(user.id, quota.source);
    throw new TruncationError();
  }

  // 4.6) UGC 止血：生成文本命中黑名单（slug 干净但模型产出违规）→ 退配额、丢弃，绝不封存
  if (findBlocked(text)){
    await kv.refundQuota(user.id, quota.source);
    throw new BlockedError("output");
  }

  // 5) 清洗真实模型输出（去掉 ```html 围栏 / 文档外壳 / 多余前言）→ 展开宏 → 包壳
  const main = expandMacros(extractFragment(text));
  const html = renderShell({ main, theme: "baidu" });

  // 6) 协商真实：第一次写入即锁定（并发首访也只锁一份）
  if (key) await kv.setIfAbsent(key, html);

  // 7) 计量已在 4.1 完成（无论成败都记账）；此处直接返回
  return { html, cached: false, key, usage, costUsd, quota };
}

// 把真实模型可能带的 markdown 围栏 / 文档外壳剥掉，只留 <main> 片段
function extractFragment(text){
  let s = String(text).trim();
  s = s.replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/i, "");   // 去代码围栏
  s = s.replace(/<!doctype[^>]*>/gi, "")
       .replace(/<\/?html[^>]*>/gi, "")
       .replace(/<head[\s\S]*?<\/head>/gi, "")
       .replace(/<\/?body[^>]*>/gi, "")
       .replace(/<\/?main[^>]*>/gi, "");
  // UGC 安全：内容会被首写永久封存并对所有人展示。剥掉模型/注入产生的危险标签——
  // 输出契约本就禁止 <script>（交互全由 runtime.js 接管），这里强制兜底，
  // 并去掉可外联钓鱼/挂马的 iframe/object/embed/link 及内联事件处理器。
  s = stripDangerous(s);
  const i = s.indexOf("<");                                          // 砍掉首个标签前的前言
  if (i > 0) s = s.slice(i);
  s = s.replace(/\[\[[^\]]*$/, "");   // 兜底：剥掉末尾未闭合的 [[... 宏残片，防字面量漏到页面
  return s;
}

// 剥掉危险标签 + 内联事件 + javascript: 协议（防存储型 XSS / 钓鱼，尽管沙箱已隔离来源）
function stripDangerous(s){
  return String(s)
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<(iframe|object|embed|link|meta|base|form)\b[\s\S]*?(?:<\/\1\s*>|>)/gi, "")
    .replace(/<\/(iframe|object|embed|form)\s*>/gi, "")   // 清孤儿闭合标签
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")    // on*="..."
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")    // on*='...'
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, "")    // on*=无引号
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1=$2#$2');
}

function meter(rec){
  // 结构化日志（落库由调用方用已鉴权的 Supabase 客户端做，受 RLS 保护）
  // finish=length 即被截断丢弃但仍计费——这行日志能直接定位“烧钱却生不出来”的尝试。
  if (process.env.GEN_LOG !== "0")
    console.log(`[meter] user=${rec.userId} key=${rec.key} ` +
      `in=${rec.usage.input} out=${rec.usage.output} cached=${rec.usage.cached||0} ` +
      `finish=${rec.finishReason || "?"} cost=$${rec.costUsd.toFixed(6)}`);
}
