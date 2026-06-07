// ============================================================
// macros.mjs — 宏占位符展开
// LLM 只写 [[...]] 短标记，服务端在写入 KV 前展开成 era.css 结构。
// 展开是确定性的（同输入同输出），符合协商真实。
// 支持：[[QUICK_GRID]] [[HOT_RANK]] [[WEATHER:城市]]
//       [[LINKS:类目]] [[AD:top|..|..]] [[AD:banner|标题|副标]]
//       [[AD:box|大字|小字]] [[AD:popup|文案]] [[INNER:slug|文字]]
// ============================================================
import {
  colorOf, pick, QUICK_APPS, LINK_SECTIONS, AD_POOL, HOT_RANK
} from "./blocks.mjs";

const esc = s => String(s).replace(/[&<>"]/g, c => (
  { "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;" }[c]));

function favSpan(name){
  return `<span class="fav" style="background:${colorOf(name)}">${esc(name.charAt(0))}</span>`;
}

function renderQuickGrid(){
  const lis = QUICK_APPS.map(t =>
    `<li><a href="javascript:;"><span class="ico" style="background:${colorOf(t)}">${esc(t.charAt(0))}</span>${esc(t)}</a></li>`
  ).join("");
  return `<div class="quick"><ul>${lis}</ul></div>`;
}

function renderLinks(cat){
  const s = LINK_SECTIONS[cat];
  if (!s) return `<!-- unknown LINKS:${esc(cat)} -->`;
  const lis = s.links.map(([name, flag]) => {
    const cls = flag === "hot" ? "hot" : (flag === "new" ? "new" : "");
    return `<li><a class="${cls}" href="javascript:;">${favSpan(name)}<span class="txt">${esc(name)}</span></a></li>`;
  }).join("");
  const subs = s.sub.map(x => `<a href="javascript:;">${esc(x)}</a>`).join("");
  return `<div class="panel"><div class="panel-hd">`
    + `<span class="bar" style="background:${s.color}"></span><h3>${esc(cat)}</h3>`
    + `<span class="sub">${subs}</span><span class="more">更多 &gt;&gt;</span></div>`
    + `<div class="links"><ul>${lis}</ul></div></div>`;
}

function renderHotRank(){
  const lis = HOT_RANK.map((t, i) =>
    `<li><span class="n">${i+1}</span><a href="javascript:;">${esc(t)}</a>${i < 2 ? ' <span class="fire">热</span>' : ''}</li>`
  ).join("");
  return `<div class="widget"><div class="widget-hd">百度热搜榜 <span>实时</span></div>`
    + `<ul class="rank">${lis}</ul></div>`;
}

function renderWeather(city){
  city = city || "北京";
  const deg = 2 + (city.charCodeAt(0) % 12); // 确定性温度
  return `<div class="widget"><div class="widget-hd">天气 <span>${esc(city)}·更新于刚刚</span></div>`
    + `<div class="weather"><div class="deg">${deg}<small>℃</small></div>`
    + `<div class="info"><div><b>${esc(city)}</b> 晴转多云</div>`
    + `<div>东北风 3级 · 湿度 32%</div><div>空气质量：<span style="color:#ff8a00">良 78</span></div></div></div></div>`;
}

function renderAd(kind, args, raw){
  if (kind === "top"){
    const [brand, title, sub] = args.length ? args : pick(AD_POOL.top, raw);
    return `<a class="top-banner" href="javascript:;"><span class="tb-l">${esc(brand||"京东")}</span>`
      + `<span class="tb-c"><b>${esc(title||"年货节")}</b><span>${esc(sub||"")}</span></span>`
      + `<span class="tb-btn">立即抢购 &gt;</span><span class="tb-tag">广告</span></a>`;
  }
  if (kind === "banner"){
    const [title, sub] = args.length ? args : pick(AD_POOL.banner, raw);
    return `<a class="banner-ad" href="javascript:;"><span class="b-txt"><b>${esc(title)}</b>`
      + `<span>${esc(sub||"")}</span></span><span class="b-btn">马上抢 &gt;</span>`
      + `<span class="b-tag">广告</span></a>`;
  }
  if (kind === "box"){
    const [big, small] = args.length ? args : pick(AD_POOL.box, raw);
    return `<a class="box-ad" href="javascript:;"><span class="badge">推广</span>`
      + `<span class="big">${esc(big)}</span><span class="small">${esc(small||"")}</span>`
      + `<span class="go">点击进入 &gt;</span><span class="tag">广告</span></a>`;
  }
  if (kind === "popup"){
    const [txt, sub] = args.length ? args : pick(AD_POOL.popup, raw);
    return `<div class="popup-ad"><div class="pa-hd">推广 <span class="x" data-close-popup>✕ 关闭</span></div>`
      + `<a class="pa-body" href="javascript:;"><span class="big">${esc(txt)}</span>`
      + `<span class="sm">${esc(sub||"")}</span><span class="go">立即抢 &gt;</span></a></div>`;
  }
  return `<!-- unknown AD:${esc(kind)} -->`;
}

/**
 * 展开一段含宏占位符的 HTML。
 * @param {string} html LLM 产出（含 [[...]]）
 * @returns {string} 展开后的完整 HTML
 */
export function expandMacros(html){
  return String(html).replace(/\[\[([A-Z_]+)(?::([^\]|]+))?(\|[^\]]*)?\]\]/g,
    (raw, name, colonArg, pipePart) => {
      const args = pipePart ? pipePart.slice(1).split("|") : [];
      switch (name){
        case "QUICK_GRID": return renderQuickGrid();
        case "HOT_RANK":   return renderHotRank();
        case "WEATHER":    return renderWeather(colonArg);
        case "LINKS":      return renderLinks(colonArg);
        case "AD":         return renderAd(colonArg, args, raw);
        case "INNER":      // [[INNER:slug|文字]]
          return `<a class="inner-link" data-slug="${esc(colonArg)}">${esc(args[0]||colonArg)}</a>`;
        default:           return `<!-- unknown macro ${esc(name)} -->`;
      }
    });
}
