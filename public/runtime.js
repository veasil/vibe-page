/* ============================================================
   runtime.js — 全站客户端运行时（壳里引一次）
   接管：时钟 / 搜索 / 设为主页 / 内链导航(postMessage) /
        广告弹窗关闭+重入队列 / 加载编排 / favicon 补色
   生成内容跑在 sandbox iframe 内，本脚本同时被父壳与 iframe 复用。
   ============================================================ */
(function () {
  "use strict";
  var inIframe = window.self !== window.top;

  function pad(n){ return n < 10 ? "0" + n : n; }

  /* ---------- 顶栏时钟 ---------- */
  function startClock(){
    var el = document.querySelector("[data-clock]");
    if (!el) return;
    var W = ["星期日","星期一","星期二","星期三","星期四","星期五","星期六"];
    function tick(){
      var d = new Date();
      el.innerHTML = d.getFullYear() + "年" + pad(d.getMonth()+1) + "月" + pad(d.getDate()) +
        "日 &nbsp;" + W[d.getDay()] + " &nbsp;<b>" +
        pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()) + "</b>";
    }
    tick(); setInterval(tick, 1000);
  }

  /* ---------- 搜索 ---------- */
  function startSearch(){
    var input = document.querySelector("[data-search-input]");
    var btn = document.querySelector("[data-search-btn]");
    function go(){
      var kw = (input && input.value || "").trim();
      if (!kw){ alert("请输入要搜索的关键词～"); return; }
      window.open("https://www.baidu.com/s?wd=" + encodeURIComponent(kw), "_blank");
    }
    if (btn) btn.addEventListener("click", go);
    if (input) input.addEventListener("keydown", function(e){ if (e.key === "Enter") go(); });
  }

  /* ---------- 设为主页彩蛋 ---------- */
  function startSetHome(){
    document.addEventListener("click", function(e){
      var t = e.target.closest && e.target.closest("[data-set-home]");
      if (!t) return;
      alert("您的浏览器不支持一键设置，请手动将 hao123 设为主页：\n工具 → Internet 选项 → 主页 → 填入 hao123.com");
    });
  }

  /* ---------- 内链导航：iframe 内点击 → 通知父窗口换 src ---------- */
  function startInnerLinks(){
    document.addEventListener("click", function(e){
      var a = e.target.closest && e.target.closest(".inner-link[data-slug]");
      if (!a) return;
      e.preventDefault();
      var slug = a.getAttribute("data-slug");
      if (inIframe){
        // 不直接跳转，交给可信父窗口校验后导航
        parent.postMessage({ type: "vibe:navigate", slug: slug }, "*");
      } else {
        location.href = "/app/" + encodeURIComponent(slug);
      }
    });
  }

  /* ---------- 广告弹窗：关闭 + 10-20s 后新广告滑入 ---------- */
  function startPopupQueue(){
    document.addEventListener("click", function(e){
      var x = e.target.closest && e.target.closest("[data-close-popup]");
      if (!x) return;
      var pop = x.closest(".popup-ad");
      if (!pop) return;
      pop.style.display = "none";
      var delay = 10000 + Math.floor(Math.random() * 10000); // 10-20s
      setTimeout(function(){
        pop.style.display = "";
        pop.style.transition = "transform .4s ease";
        pop.style.transform = "translateX(120%)";
        requestAnimationFrame(function(){ pop.style.transform = "translateX(0)"; });
      }, delay);
    });
  }

  /* ---------- favicon 补色（万一未内联背景色） ---------- */
  function paintFav(){
    var pal = ["#2b8eea","#ff5000","#e1251b","#00be06","#fdb933","#6a5acd","#16a085","#f5317f"];
    document.querySelectorAll(".fav").forEach(function(el){
      if (el.style.background) return;
      var name = el.getAttribute("data-name") || el.textContent || "x";
      var h = 0; for (var i=0;i<name.length;i++) h = (h*31 + name.charCodeAt(i)) & 0x7fffffff;
      el.style.background = pal[h % pal.length];
    });
  }

  /* ---------- 加载编排：图片 pop-in / 个别先破损 ---------- */
  function startLoadingChoreo(){
    var imgs = document.querySelectorAll(".lazy-img");
    imgs.forEach(function(img, i){
      var base = 300 + Math.random() * 300;        // 300-600ms
      if (i % 7 === 0){                              // 1/7 先破损再"加载成功"
        setTimeout(function(){ img.classList.add("broken"); }, base);
        setTimeout(function(){ img.classList.remove("broken"); img.classList.add("loaded"); }, base + 300);
      } else {
        setTimeout(function(){ img.classList.add("loaded"); }, base);
      }
    });
    document.querySelectorAll(".ad-slot.loading").forEach(function(slot){
      setTimeout(function(){ slot.classList.remove("loading"); }, 800 + Math.random()*400);
    });
  }

  function boot(){
    startClock(); startSearch(); startSetHome();
    startInnerLinks(); startPopupQueue();
    paintFav(); startLoadingChoreo();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
