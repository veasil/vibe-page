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

export class QuotaError extends Error {
  constructor(q){ super(`今日生成配额已用尽（${q.used}/${q.max}）`); this.name = "QuotaError"; this.status = 429; this.quota = q; }
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

  // 4.5) 被截断 → 页面不完整，退还配额并丢弃，绝不写入 KV（否则坏页被永久锁定）
  if (finishReason === "length"){
    await kv.refundQuota(user.id);
    throw new TruncationError();
  }

  // 5) 清洗真实模型输出（去掉 ```html 围栏 / 文档外壳 / 多余前言）→ 展开宏 → 包壳
  const main = expandMacros(extractFragment(text));
  const html = renderShell({ main, theme: "baidu" });

  // 6) 协商真实：第一次写入即锁定（并发首访也只锁一份）
  if (key) await kv.setIfAbsent(key, html);

  // 7) 计量（生产写 generations 表；此处返回 + 可日志）
  const costUsd = llm.estCostUsd(usage);
  meter({ userId: user.id, key, usage, costUsd });

  // 7.5) 轻量 KV 聚合计数（admin 控制台读，mock/Upstash 通用）——不阻塞响应
  kv.bumpGenStats({
    inTok: usage.input || 0, outTok: usage.output || 0,
    costMicro: Math.round(costUsd * 1e6),
  }).catch(() => {});

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
  if (process.env.GEN_LOG !== "0")
    console.log(`[meter] user=${rec.userId} key=${rec.key} ` +
      `in=${rec.usage.input} out=${rec.usage.output} cached=${rec.usage.cached||0} ` +
      `cost=$${rec.costUsd.toFixed(6)}`);
}
