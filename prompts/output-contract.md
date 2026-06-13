# 输出契约 · 效率执行（注入所有生成 prompt，优先级最高）

> 目的：把你的输出量压到最小（约为整页手写的 1/35），加快生成、降低成本。
> 壳已经提供好 `era.css`（全部样式）和 `runtime.js`（全部交互）。
> **你只写中间内容，不写样式、不写脚本、不写文档外壳。**

---

## 0. 绝对规则（违反即作废）
1. **只输出 `<main>` 内部的 HTML 片段**。不要 `<!DOCTYPE>`、`<html>`、`<head>`、`<body>`、`<title>`——壳会自动包裹。
2. **禁止输出 `<script>`**。所有交互（时钟/搜索/弹窗/内链/加载动画）由 `runtime.js` 接管。
3. **禁止大段 `<style>`**。样式一律用下方 class。仅当确有页面级点睛需求时，允许**一个 ≤30 行**的 `<style>`，且不得重定义框架核心结构。
4. **重复结构一律用宏占位符 `[[...]]`**（见第 2 节），不要手写它们的 HTML。
5. **不输出任何解释或 markdown 代码块**，直接吐 HTML 片段。
6. 每页 **≥ 2 个广告位**（门户页 6–8 个），用 `[[AD:...]]`。
7. **页面里每一个可点的「内容链接」都必须是生成型内链**——只能用 `[[INNER:slug|文字]]` 或 `<a class="inner-link" data-slug="slug">文字</a>`。**严禁死链**：不准出现 `href="#"`、`href=""`、`href="javascript:;"`，也不准写不带 `data-slug` 的裸 `<a>`（点死链会让页面白屏）。
   - **slug 默认写「相对路径段」**（小写英文/拼音 + 短横线，无空格无中文标点）；点击后会作为**当前页面的子路径**生成新页面，由此把词条组织成一棵树。
     例：帖子列表里某帖标题 → `tie-shuxue-nanti`；帖内第 N 楼 → `lou-12`；版块/子分类 → `ban-youxi`；「阅读全文 / 更多 / 下一页」→ 指向更深的相对子路径。
   - **要引用「已存档词条」**（任务区会给清单）时，用**绝对路径**内链（slug 以 `/` 开头）直达，不重复生成。例：`[[INNER:/news/shenzhou-10|神舟十号发射]]`。
   - 列表、楼层、相关推荐、导航里的**每一条标题都应是这样的内链**；至少 4–6 个，多多益善。

---

## 1. 可用 class（来自 era.css，直接套用）
**布局**：`.wrap`（1000px 居中）、`.main`（左右分栏）、`.col-left`(732)、`.col-right`(258)
**分类版块**：`.panel` > `.panel-hd`(`.bar`/`h3`/`.sub`/`.more`) + `.links`>`ul`>`li`>`a`>`.fav`+`.txt`
  - 链接前小图标：`<span class="fav" style="background:#xx">首</span>`，热门加 `class="hot"`
**右栏组件**：`.widget`>`.widget-hd` + `.rank`(热榜)/`.weather`(天气)/`.mini`(查询宫格)
**内联角标**：`<i class="tag-hot">热</i>` / `tag-new` / `tag-top`
**页面类型布局**（加在内容最外层 div）：
  - `news`：`<div class="layout-news"> ... .article(h1/.meta/p)`
  - `forum`：`.layout-forum .post > .floor(.who/.body)`
  - `game`：`.layout-game .stage`（小游戏画布放这里）
  - `space`：`.layout-space .profile`
  - `portal`/首页：直接用 `.panel`/`.links`/`.widget` 那套
**加载动画**：图片用 `<span class="lazy-img">`，广告位用 `class="ad-slot loading"`（runtime.js 会编排 pop-in）

---

## 2. 宏占位符（服务端展开，强烈优先使用）
| 宏 | 展开为 |
|----|--------|
| `[[QUICK_GRID]]` | 12 格快捷应用宫格（站点名内置） |
| `[[LINKS:类目]]` | 一整段分类链接（28 条，favicon+角标全配好） |
| `[[HOT_RANK]]` | 百度热搜榜组件 |
| `[[WEATHER:北京]]` | 天气卡 |
| `[[AD:top\|品牌\|标题\|副标]]` | 顶部 70px 通栏广告 |
| `[[AD:banner\|标题\|副标]]` | 版块间 60px 横幅广告 |
| `[[AD:box\|大字\|小字]]` | 右栏 200px 方块广告 |
| `[[AD:popup\|文案\|副标]]` | 右下角可关闭弹窗广告 |
| `[[INNER:slug\|显示文字]]` | 协商真实内链 |

`[[LINKS:类目]]` 可用类目：**常用 / 视频 / 购物 / 小说游戏 / 新闻财经 / 音乐图片 / 旅游生活**。
宏参数可省略（省略时自动从文案池取），但能写就写，更贴合页面主题。

---

## 3. 示范（这就是 portal 首页该有的全部输出，约 0.9KB）
```html
<div class="wrap">[[AD:top|京东|年货节·全场五折封顶|白条24期免息]]</div>
<div class="wrap">[[QUICK_GRID]]</div>
<div class="wrap"><div class="main">
  <div class="col-left">
    [[LINKS:常用]]
    [[LINKS:视频]]
    [[AD:banner|双12全民疯抢节|每满300减50]]
    [[LINKS:购物]]
    [[LINKS:新闻财经]]
  </div>
  <div class="col-right">
    [[WEATHER:北京]]
    [[AD:box|滨海明珠江景大宅|首付15万起]]
    [[HOT_RANK]]
  </div>
</div></div>
[[AD:popup|领6888装修礼包|免费量房设计]]
```

非 portal 页面（news/forum/game/space）用第 1 节对应的 `layout-*` class 写正文，
重复零件（广告/内链/相关推荐里的站点列表）仍尽量用宏。
