// ============================================================
// shell.mjs — A 层框架壳（每页相同，零 LLM token）
// 把 era.css/runtime.js、顶栏、logo、搜索、页脚固定下来，
// 生成内容只填中间 <main id="page">。
// 在 Next 里这部分会变成 layout.tsx 的 React 组件；这里给纯字符串版，
// 供 SSR 包裹 + demo 复用。
// ============================================================

/**
 * @param {object} opt
 * @param {string} opt.title    页面标题
 * @param {string} opt.theme    'baidu' | 'sina' | 'sohu'
 * @param {string} opt.layout   '' | 'layout-news' | 'layout-forum' | 'layout-game' | 'layout-space'
 * @param {string} opt.main     已展开宏的页面正文 HTML
 * @param {string} [opt.cssHref]  era.css 路径（默认 /era.css）
 * @param {string} [opt.jsHref]   runtime.js 路径（默认 /runtime.js）
 * @param {string} [opt.styleBudget] D 层可选 <style> 预算（≤30 行）
 */
export function renderShell(opt){
  const {
    title = "hao123_上网从这里开始",
    theme = "baidu",
    layout = "",
    main = "",
    cssHref = "/era.css",
    jsHref = "/runtime.js",
    styleBudget = ""
  } = opt;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=1024">
<title>${title}</title>
<link rel="stylesheet" href="${cssHref}">
${styleBudget ? `<style>${styleBudget}</style>` : ""}
</head>
<body data-theme="${theme}" class="${layout}">

<div class="topbar"><div class="wrap">
  <div>
    <a class="set-home" href="javascript:;" data-set-home>★ 设为主页</a>
    <a href="javascript:;">加入收藏</a>
    <span class="tz" data-clock></span>
  </div>
  <div>
    <a href="javascript:;">登录</a>|<a href="javascript:;">注册</a>|<a href="javascript:;">客户端</a>
  </div>
</div></div>

<div class="header"><div class="wrap">
  <div class="logo"><span class="ha">hao</span><span class="num">123</span><small>上网从这里开始</small></div>
  <div class="search">
    <div class="engine-tabs">
      <a class="on" href="javascript:;">网页</a><a href="javascript:;">资讯</a>
      <a href="javascript:;">视频 <small>HD</small></a><a href="javascript:;">图片</a>
      <a href="javascript:;">音乐</a><a href="javascript:;">地图</a><a href="javascript:;">问答</a>
    </div>
    <div class="search-row">
      <div class="baidu-logo">Bai<b>百度</b></div>
      <div class="search-box">
        <input data-search-input type="text" placeholder="输入想搜的内容" autocomplete="off">
        <button data-search-btn>百度一下</button>
      </div>
    </div>
    <div class="hot-words">
      <a class="fire" href="javascript:;">春节抢票攻略</a>
      <a class="fire" href="javascript:;">最新大片在线看</a>
      <a href="javascript:;">天气预报</a><a href="javascript:;">12306</a>
    </div>
  </div>
</div></div>

<main id="page">${main}</main>

<div class="footer"><div class="wrap">
  <div class="nav">
    <a href="javascript:;">关于hao123</a>|<a href="javascript:;">收录网站</a>|
    <a href="javascript:;">意见反馈</a>|<a href="javascript:;">网站地图</a>
  </div>
  <div class="copy">京ICP证030173号 · 京公网安备 11000002000001号<br>
    © 2010-2016 hao123.com 版权所有 &nbsp;|&nbsp; 上网从这里开始</div>
</div></div>

<script src="${jsHref}"></script>
</body>
</html>`;
}
