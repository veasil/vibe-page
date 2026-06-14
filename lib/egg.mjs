// ============================================================
// egg.mjs — 彩蛋层（v1）
// 概念：整站锚定「今天−13年」。每期(15天)一个谜底=13年前那个时期真实发生的
//       「非显词」事/物。玩家靠落地页线索自由探索，命中关键词即进彩蛋页。
// 判定放在 /api/generate 缓存查询【之前】：本期命中 → 覆盖普通页返回彩蛋页，
//   不扣配额；期一过该词又变回普通词条页。谜底只存服务端，绝不下发前端。
// 数据：
//   egg:current                       本期彩蛋配置（admin 写 / auto 助手填）
//   egg:found:<period>:<userId>       该用户已发现（时间戳）
//   egg:found:<period>:count          本期发现人数
// 版式：renderEggPage() 为占位实现，待正式设计；mode='html' 时用 admin 手写整页。
// ============================================================
import * as kv from "./kv.mjs";

const ANCHOR = "2026-06-14";   // 第 1 期起点（可调）
const PERIOD_DAYS = 15;

/** 第 N 期（从 1 开始，按真实日期推进 → 永远贴着移动的「13年前此刻」） */
export function currentPeriod(){
  const ms = Date.now() - Date.parse(ANCHOR + "T00:00:00Z");
  return Math.max(0, Math.floor(ms / (PERIOD_DAYS * 86400000))) + 1;
}

// 归一化（与 blocklist 一致）：小写 + 去分隔，吃掉 神舟10/shen-zhou 这类写法差异
const norm = s => String(s || "").toLowerCase().replace(/[\s\-_/.]+/g, "");

export async function getEgg(){ return (await kv.get("egg:current")) || null; }

/** admin 写入本期彩蛋（自动带上当前期号） */
export async function setEgg(cfg){
  const egg = {
    keyword:  String(cfg.keyword || "").trim(),
    aliases:  Array.isArray(cfg.aliases) ? cfg.aliases : String(cfg.aliases || "").split(/[，,、\s]+/).filter(Boolean),
    clue:     String(cfg.clue || "").trim(),
    fact:     String(cfg.fact || "").trim(),
    now:      String(cfg.now || "").trim(),
    badge:    String(cfg.badge || "").trim(),
    mode:     cfg.mode === "html" ? "html" : "template",
    html:     String(cfg.html || ""),
    period:   currentPeriod(),
    updatedAt: Date.now(),
  };
  await kv.put("egg:current", egg);
  return egg;
}

/** 输入(slug/query) 是否命中本期谜底（命中即触发：归一后含关键词或别名） */
export function matchEgg(input, egg){
  if (!egg || !egg.keyword || !input) return false;
  const n = norm(input);
  if (!n) return false;
  return [egg.keyword, ...(egg.aliases || [])].map(norm).filter(Boolean).some(t => n.includes(t));
}

/** 记一次发现（首次发现 incr 计数）；返回 {count, already} */
export async function markFound(period, userId){
  const fk = `egg:found:${period}:${userId}`;
  const ck = `egg:found:${period}:count`;
  if (await kv.get(fk)) return { count: +(await kv.get(ck)) || 0, already: true };
  await kv.put(fk, Date.now());
  return { count: await kv.incr(ck), already: false };
}

/** 公开线索（落地页用）：只吐期号/线索/发现数，绝不含谜底 */
export async function publicClue(){
  const period = currentPeriod();
  const egg = await getEgg();
  const foundCount = +(await kv.get(`egg:found:${period}:count`)) || 0;
  return { period, clue: egg?.clue || null, foundCount };
}

const esc = s => String(s || "").replace(/[&<>"]/g, c => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));

/**
 * 渲染彩蛋页。⚠️ 占位版式——待正式设计；改动只在本函数内。
 * mode='html' → 直接用 admin 手写整页（{{字段}} 占位可选支持）。
 * @param {object} egg  本期彩蛋
 * @param {{rank:number, already:boolean}} found
 */
export function renderEggPage(egg, found = {}){
  if (egg.mode === "html" && egg.html){
    return egg.html
      .replaceAll("{{keyword}}", esc(egg.keyword))
      .replaceAll("{{rank}}", String(found.rank || ""))
      .replaceAll("{{fact}}", esc(egg.fact))
      .replaceAll("{{now}}", esc(egg.now))
      .replaceAll("{{badge}}", esc(egg.badge));
  }
  // —— 占位模板（功能可用、版式待你设计）——
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=1024"><title>你找到了 · 彩蛋</title>
<style>
 body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
   background:#15171c;color:#e8e6e0;font-family:"Microsoft YaHei",serif;padding:40px}
 .egg{max-width:560px;text-align:center}
 .hi{color:#d9a441;font-size:13px;letter-spacing:2px;margin-bottom:20px}
 .kw{font-size:34px;font-weight:700;letter-spacing:4px;margin:0 0 28px}
 .card{background:#1e2128;border:1px solid #333;border-radius:6px;padding:22px;text-align:left;
   line-height:1.9;font-size:14px;color:#cfcabf;filter:sepia(.25)}
 .card h4{margin:0 0 10px;color:#b9b2a4;font-weight:400;font-size:12px;letter-spacing:1px}
 .sep{margin:26px 0 14px;color:#666;font-size:12px;letter-spacing:2px}
 .now{font-size:15px;color:#e8e6e0;line-height:1.8}
 .badge{margin-top:24px;color:#d9a441;font-size:13px}
 .acts{margin-top:30px}
 .acts a{color:#7fb2e6;text-decoration:none;margin:0 12px;font-size:13px}
 .todo{margin-top:30px;color:#555;font-size:11px}
</style></head><body>
<div class="egg">
 <div class="hi">✦ 你找到了本期彩蛋 · 第 ${found.rank || "?"} 位发现者${found.already ? "（你已发现过）" : ""}</div>
 <div class="kw">${esc(egg.keyword)}</div>
 <div class="card"><h4>13 年前的今天</h4>${esc(egg.fact) || "（史实文案待填）"}</div>
 <div class="sep">——— 然后，13 年过去了 ———</div>
 <div class="now">${esc(egg.now) || "（13 年后的寄语待填）"}</div>
 ${egg.badge ? `<div class="badge">🏅 解锁纪念徽章「${esc(egg.badge)}」</div>` : ""}
 <div class="acts"><a href="/app.html">继续探索这张幻觉网</a></div>
 <div class="todo">（彩蛋页版式为占位实现，待设计）</div>
</div></body></html>`;
}
