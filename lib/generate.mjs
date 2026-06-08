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
  const { text, usage } = await llm.generate(messages, GEN_PARAMS);

  // 5) 清洗真实模型输出（去掉 ```html 围栏 / 文档外壳 / 多余前言）→ 展开宏 → 包壳
  const main = expandMacros(extractFragment(text));
  const html = renderShell({ main, theme: "baidu" });

  // 6) 协商真实：第一次写入即锁定（并发首访也只锁一份）
  if (key) await kv.setIfAbsent(key, html);

  // 7) 计量（生产写 generations 表；此处返回 + 可日志）
  const costUsd = llm.estCostUsd(usage);
  meter({ userId: user.id, key, usage, costUsd });

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
  const i = s.indexOf("<");                                          // 砍掉首个标签前的前言
  return i > 0 ? s.slice(i) : s;
}

function meter(rec){
  // 结构化日志（落库由调用方用已鉴权的 Supabase 客户端做，受 RLS 保护）
  if (process.env.GEN_LOG !== "0")
    console.log(`[meter] user=${rec.userId} key=${rec.key} ` +
      `in=${rec.usage.input} out=${rec.usage.output} cached=${rec.usage.cached||0} ` +
      `cost=$${rec.costUsd.toFixed(6)}`);
}
