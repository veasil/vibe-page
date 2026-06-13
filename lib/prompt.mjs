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

// 时代锚点：现实今天 − 13 年（含星期，按 13 年前那天算）
export function eraToday(){
  const d = new Date();
  d.setFullYear(d.getFullYear() - 13);
  const W = ["日", "一", "二", "三", "四", "五", "六"];
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 星期${W[d.getDay()]}`;
}

// —— 稳定前缀：合并三份约束（进程内按天缓存；同一天内前缀稳定以命中 LLM 上下文缓存）——
let _prefix = null, _prefixDay = "";
export function systemPrefix(){
  const day = new Date().toISOString().slice(0, 10);
  if (_prefix && _prefixDay === day) return _prefix;
  _prefixDay = day;
  _prefix = [
    "你是「协商真实·幻觉导航网」的页面生成引擎。严格遵守以下三层约束。",
    "\n\n===== 输出契约（优先级最高，违反即作废）=====\n" + read("output-contract.md"),
    "\n\n===== 层一 · 美学约束 =====\n" + read("aesthetic.md"),
    "\n\n===== 层二 · 时代约束 =====\n" + read("era.md").replaceAll("{{ERA_TODAY}}", eraToday()),
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
    ? `\n已存档词条（要引用就用【绝对路径】内链 [[INNER:/完整路径|文字]] 直达，不要重复生成）：\n${slugs.map(s => "/" + s).join("、")}`
    : "\n（暂无已存档词条）";

  if (t.type === "home"){
    return `\n\n===== 本次任务 =====\n生成站点首页（portal 类）。
按输出契约第 3 节的 portal 示范结构：通栏广告 + 快捷宫格 + 左多版块([[LINKS:...]]) + 右栏(天气/方块广告/热榜)。
铺 6–8 个广告位。宫格/版块链接由宏自动生成（点击各自成页），你额外写的内容链接也须是生成型内链（顶层用绝对 slug）。${refs}\n\n直接输出 <main> 内的 HTML 片段：`;
  }
  if (t.type === "search"){
    const q = sanitizeSlug(t.query);
    return `\n\n===== 本次任务 =====\n生成关键词「${q}」的搜索结果页。
顶部一条结果统计，下面 8–12 条结果（标题=蓝链、绿色网址、两行摘要），右栏放相关搜索 + 广告。
每条结果标题都是生成型内链：用**绝对路径** slug（如 [[INNER:/news/xxx|标题]]）通向该词条页，不要相对路径。${refs}\n\n直接输出 <main> 内的 HTML 片段：`;
  }
  // page
  const path = sanitizeSlug(t.path);
  return `\n\n===== 本次任务 =====\n为路径「/${path}」生成内容页。
先据路径语义自判页面类型（news/game/forum/space/portal，见层二），套用对应 layout-* class。
内容要"基本像真的"+轻微错位，符合 2013 时代腔调。重复零件用宏，≥2 广告位。
页面里每个可点内容（帖子/楼层/子类/详情/相关/下一页）都用生成型内链：本页细分内容用**相对 slug**（点击生成「/${path}/<slug>」子页面，形成词条树），跨词条引用用绝对路径。严禁死链。${refs}\n\n直接输出 <main> 内的 HTML 片段：`;
}

/** 组装成 chat messages（system 放稳定前缀以命中缓存） */
export function buildMessages(task){
  return [
    { role: "system", content: systemPrefix() },
    { role: "user",   content: taskSuffix(task) },
  ];
}

// 生成调用建议参数（model 由 llm.mjs 按 provider 决定，不在此硬编码）
// max_tokens 给足：2500/4000 都会把密集 era 页（尤其多结果的搜索页）腰斩
// （finish_reason=length → 502 丢弃重生）。MiMo ultraspeed 快，给足 8000 留冗余。
// 治本仍需调 prompt 遵从度，让模型出紧凑片段+用宏，而非吐整页 HTML。
export const GEN_PARAMS = { temperature: 0.9, max_tokens: 8000, stream: true };
