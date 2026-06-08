// ============================================================
// prompt.mjs — 系统 prompt 组装（效率方案核心入口）
// 顺序经过精心设计以命中 DeepSeek 上下文缓存：
//   [稳定前缀：三份约束文件] 永远不变 → 命中缓存，输入价 ≈1/10
//   [动态后缀：本次任务]     每次不同 → 不缓存
// 同时把"只写片段+用宏+不写CSS/JS"的效率契约钉进 prompt。
// ============================================================
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// 兼容 node demo（cwd=根）与 Next 打包（import.meta.url 可能指向 .next）
const _cands = [
  join(process.cwd(), "prompts"),
  join(dirname(fileURLToPath(import.meta.url)), "..", "prompts"),
];
const PROMPTS = _cands.find(existsSync) || _cands[0];
const read = f => readFileSync(join(PROMPTS, f), "utf8");

// —— 稳定前缀：合并三份约束（进程内缓存，避免每次读盘）——
let _prefix = null;
export function systemPrefix(){
  if (_prefix) return _prefix;
  _prefix = [
    "你是「协商真实·幻觉导航网」的页面生成引擎。严格遵守以下三层约束。",
    "\n\n===== 输出契约（优先级最高，违反即作废）=====\n" + read("output-contract.md"),
    "\n\n===== 层一 · 美学约束 =====\n" + read("aesthetic.md"),
    "\n\n===== 层二 · 时代约束 =====\n" + read("era.md"),
  ].join("");
  return _prefix;
}

const MAX_SLUG = 120;
const CTRL = new RegExp("[\\u0000-\\u001f\\u007f]", "g"); // 控制字符
// 入 prompt 前清洗 slug，防注入 / 防炸 KV
export function sanitizeSlug(s){
  return String(s || "")
    .replace(CTRL, "")     // 剥控制字符
    .replace(/[<>]/g, "")  // 防注入
    .slice(0, MAX_SLUG);
}

/**
 * 动态后缀：本次任务。
 * @param {object} t
 * @param {'home'|'search'|'page'} t.type
 * @param {string} [t.path]            type=page 的 catch-all 路径
 * @param {string} [t.query]           type=search 的关键词
 * @param {string[]} [t.existingSlugs] KV 已存档词条，供自引用内链
 */
export function taskSuffix(t){
  const slugs = (t.existingSlugs || []).slice(0, 60).map(sanitizeSlug).filter(Boolean);
  const refs = slugs.length
    ? `\n已存档词条（请优先用 [[INNER:slug|文字]] 引用其中相关者，做协商真实自引用）：\n${slugs.join("、")}`
    : "\n（暂无已存档词条，可自行创造 4–6 个合理内链）";

  if (t.type === "home"){
    return `\n\n===== 本次任务 =====\n生成站点首页（portal 类）。
按输出契约第 3 节的 portal 示范结构：通栏广告 + 快捷宫格 + 左多版块([[LINKS:...]]) + 右栏(天气/方块广告/热榜)。
铺 6–8 个广告位。${refs}\n\n直接输出 <main> 内的 HTML 片段：`;
  }
  if (t.type === "search"){
    const q = sanitizeSlug(t.query);
    return `\n\n===== 本次任务 =====\n生成关键词「${q}」的搜索结果页。
顶部一条结果统计，下面 8–12 条结果（标题=蓝链、绿色网址、两行摘要），右栏放相关搜索 + 广告。
结果里自然嵌入 4–6 个 [[INNER:slug|文字]] 通向相关词条。${refs}\n\n直接输出 <main> 内的 HTML 片段：`;
  }
  // page
  const path = sanitizeSlug(t.path);
  return `\n\n===== 本次任务 =====\n为路径「/${path}」生成内容页。
先据路径语义自判页面类型（news/game/forum/space/portal，见层二），套用对应 layout-* class。
内容要"基本像真的"+轻微错位，符合 2013 时代腔调。重复零件用宏，≥2 广告位，4–6 个内链。${refs}\n\n直接输出 <main> 内的 HTML 片段：`;
}

/** 组装成 chat messages（system 放稳定前缀以命中缓存） */
export function buildMessages(task){
  return [
    { role: "system", content: systemPrefix() },
    { role: "user",   content: taskSuffix(task) },
  ];
}

// 生成调用建议参数（接 DeepSeek 时用）
export const GEN_PARAMS = { model: "deepseek-chat", temperature: 0.9, max_tokens: 2500, stream: true };
