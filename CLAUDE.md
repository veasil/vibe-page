# 协商真实 · 幻觉导航网

## 概念

模仿 2013 年中国互联网的 serverless web 产品。所有页面由 AI 实时生成完整 HTML+CSS，视觉风格不固定，但受美学约束系统约束。用户第一次触发某个路径，AI 生成并存入 Vercel KV，此后永久固定——**第一次生成即成为该路径的「真实」**。

---

## 逻辑层划分

### 层一：美学约束系统（注入所有 AI prompt，不是模板，是大气层）

AI 可以自由决定页面结构，但必须在以下参数内生成：

**信息密度**
- 每屏可见可点击元素 > 30 个
- 行间距紧凑（line-height 1.4-1.6），留白是浪费
- 多列布局为主（3列及以上）
- 折叠内容用 tab 切换，不用空白分隔

**字体规则（严格限定，不可使用其他字体）**
- 中文：微软雅黑、宋体
- 英文：Arial、Tahoma、Verdana
- 链接色：未访问 #0000CC，已访问 #551A8B，hover #CC0000
- 正文字号：12px 或 14px

**色彩规则**
- 不允许出现任何渐变色、毛玻璃、阴影
- 主色调选其一：新浪红 #CC0000 / 百度蓝 #1E6BB8 / 搜狐橙 #FF6600
- 背景：纯白 #FFFFFF 或浅灰 #F5F5F5 或浅蓝 #EEF2FF
- 边框：#CCCCCC 实线 1px

**装饰元素**
- 小彩色方块徽章（HOT / NEW / TOP），用 inline-block + background-color 实现
- 分割线用渐变或点线 border-bottom: 1px dashed #CCCCCC
- 允许 GIF 动图占位（用 CSS animation 模拟闪烁替代真实 GIF）
- 图标用文字符号或 Unicode，不用 SVG

**广告行为规则**
- 每个页面必须包含至少 2 个广告位
- 位置：顶部 banner (728x90) + 右侧竖条 (160x600)
- 广告 div 带虚线边框 + 「广告」小字标注
- 浮动广告带关闭按钮（`position: fixed`，右下角）
- 广告关闭后 10-20 秒新广告从角落滑入（JS setTimeout 队列）

**加载行为规则（JavaScript 编排，不是真实加载）**
```
0ms        → 骨架出现（导航、文字框架）
300-600ms  → 图片 pop in（突然出现，visibility: hidden → visible）
             1-2 张先显示破损图标 300ms 再「成功加载」
800-1200ms → 广告位出现，先转圈占位，delay 后替换内容
多列内容    → 从上到下逐行出现，模拟表格渲染
```

---

### 层二：AI 内容与结构生成层

**全局时代约束（所有 prompt 都注入；日期动态 = 现实今天 − 13 年，由 `lib/prompt.mjs` 的 `eraToday()` 注入 `prompts/era.md` 的 `{{ERA_TODAY}}`，顶栏时钟/landing 文案同步减 13 年）**
```
今天是 {{ERA_TODAY}}。你是运行在这一天的中文互联网内容系统。
只知道这一天及之前的信息。

文化参照：神舟十号发射倒计时、雾霾话题爆发、余额宝刚上线、
微信 4.x、小米 2S、iPhone 5 是旗舰机、人人网鼎盛、韩流鼎盛、
网络热词：屌丝 高富帅 白富美 正能量 亲 伤不起 神马 浮云
新闻腔调：震惊体 网友热议 专家表示 记者了解到 本报讯
```

**页面类型（由 AI 根据 slug/path 自行判断，不做人工分类）**

AI 根据路径语义推断类型，选择对应的视觉风格生成：

| 类型 | 触发条件示例 | 视觉风格 |
|------|-------------|----------|
| news | 新闻、事件、人物词条 | 新浪/搜狐门户，红蓝导航，正文+右侧相关 |
| game | 游戏名、攻略、下载 | 暗色背景、大图 banner、可玩的 JS 小游戏 |
| forum | 吧、帖子、讨论、社区 | 表格布局、楼层结构、头像+签名 |
| space | 个人主页、博客、日志 | 拟人化装饰、音乐播放器占位、相册格子 |
| portal | 官网、首页、介绍 | 品牌色、图文混排、产品展示区 |

**游戏页面特殊要求**
- 生成完整可运行的 JS 小游戏（贪吃蛇、打地鼠、简单弹球等）
- 游戏内嵌在页面中，周围有攻略文字和相关游戏链接
- 必须真的可以玩

**内容细节要求**
- 细节轻微错位（日期偏移、人名职位混淆、因果略有倒置）
- 整体「基本像真的」，不要明显荒诞
- 每页包含 4-6 个内链：`<a class="inner-link" data-slug="词条名">文字</a>`
- 已存档词条列表注入 prompt，优先作为内链引用（协商真实自引用）

**输出格式（效率方案 · 见 `prompts/output-contract.md`）**
- **只输出 `<main>` 内部 HTML 片段**：不写 `<html>/<head>/<body>`，不写 `<script>`，不写大段 `<style>`（壳已提供 `public/era.css` + `public/runtime.js`）
- 样式套用 `era.css` 的 class；重复结构用宏占位符 `[[...]]`，服务端 `lib/macros.mjs` 写入 KV 前展开
- 仅允许一个 ≤30 行的页面级 `<style>` 点睛
- 不输出任何解释或 markdown；CSS/交互必须符合层一美学约束
- 收益：LLM 输出量约为整页手写的 **1/35**（实测 871B vs 30KB），叠加 prompt 缓存 + `max_tokens` 封顶

---

### 层三：存储层

**Vercel KV（协商真实）**
```typescript
// 首页导航
kv.set('home', html)

// 内容页（第一次写入，不可覆盖）
const existing = await kv.get(`page:${slug}`)
if (!existing) await kv.set(`page:${slug}`, html)

// 取全部词条（注入 prompt 用于自引用 + 首页计数）
const keys = await kv.keys('page:*')
```

**Supabase（反馈）**
```sql
create table feedback (
  id uuid default gen_random_uuid() primary key,
  page_url text not null,
  slug text,
  type text check (type in ('too_obvious', 'too_real', 'content_issue', 'other')),
  comment text,
  created_at timestamptz default now()
);
```

---

## 路由结构

```
/                     → 首页（KV-first，key: home）
/search?q=xxx         → 搜索结果页（每次实时生成，不缓存）
/[...path]            → 所有内容页（catch-all，KV-first）
/feedback             → 反馈页
/api/generate         → streaming API route
/api/feedback         → POST，写 Supabase
```

catch-all 路由使得 `/game/lol`、`/bbs/post/12345`、`/space/user/zhang3` 都合法，AI 根据完整路径推断页面类型。

---

## API Route `/api/generate`

```typescript
{
  type: 'home' | 'search' | 'page',
  path?: string,           // catch-all 路径，type=page 时
  query?: string,          // type=search 时
  existingSlugs: string[]  // 从 KV keys 读取，注入自引用
}

// LLM 主选：DeepSeek（deepseek-chat）
// 备选：Kimi API（月之暗面）
// base URL: https://api.deepseek.com/v1
// 输出：streaming HTML
```

---

## 环境变量

```
LLM_PROVIDER=          # mimo | deepseek（缺省：谁有 key 用谁，mimo 优先）
MIMO_API_KEY=          # 小米 MiMo，model: mimo-v2.5-pro-ultraspeed（~5s/页）
DEEPSEEK_API_KEY=
KV_REST_API_URL=
KV_REST_API_TOKEN=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

---

## 设计素材库：导航站 / 门户页范式（hao123 样张）

> 这是层一「美学约束系统」的**具体落地素材**，从复刻 hao123（2010s 网址导航站）提炼。
> AI 生成 `portal` / 首页 / 导航类页面时，应把本节当成可直接照搬的骨架与组件库。
> 参照样张文件：`public/reference/hao123.html`。
> 本节内容已拆出为可注入的 prompt 片段：`prompts/aesthetic.md`（层一美学）、`prompts/era.md`（层二时代约束）。

### 页面骨架顺序（自上而下，固定节奏）
```
顶栏(30px)   设为主页 + 加入收藏 + 实时时钟 ｜ 角落文字广告 + 登录/注册
头部         斜体 logo（hao蓝 + 123红）＋ 搜索区
通栏大广告   728 宽级别的横幅（红橙渐变 + 抢购按钮）
快捷宫格     12 列圆角彩色图标 + 文字
主体         左 732px 分类版块区　｜　右 258px 小工具+广告竖列
底部         ICP 备案号 + 版权 + © 2010-2016
```

### 信息密度（硬指标，留白即浪费）
- 分类版块每行 **7 列**（`width:14.28%`），每个版块 **≈28 条**链接
- 行高 **23px**，正文 **12px**，标题 **14px**
- 首屏可点击元素远超 30 个；版块之间只用 1px 边框/虚线分隔，不留空段

### 链接条范式（最关键的"那个年代味"）
- 结构：`<a>` = **小图标方块 + 文字**，图标永远在文字**前面**
- favicon 方块：`14×14`，圆角 2px，背景=按站名哈希取的稳定色，内放站名**首字**（白色 9px 粗体）
- 角标：`HOT` → 文字直接红色 `#e60012`；`NEW` → 文字后跟橙色 `new` 小胶囊 `#ff8a00`

### 搜索区范式
- 引擎切换 tab（网页/资讯/视频/图片/音乐/地图/问答），选中页带 2px 蓝顶边
- `Bai百度` 斜体 logo + **2px 蓝边**搜索框（`#2b8eea`）+ 蓝色渐变「百度一下」按钮（字距 4px）
- 下方「热门搜索」词，前两个标红

### 分类版块组件
- 版块头：**左侧 3px 竖色条** + 标题 + 灰色子分类链接 + 右对齐「更多 >>」
- 每个版块色条用不同主色（蓝/红/橙/绿/紫…），整页形成彩色节奏

### 右栏小工具（固定三件套 + 广告）
- **天气卡**：大号橙色温度数字 + 城市/风力/空气质量
- **热搜榜**：前 3 名序号方块依次红 `#e60012` / 橙 `#ff6600` / 黄 `#ff9900`，带「热」角标
- **实用查询**：4 列宫格（万年历/火车票/快递/汇率/股票…）

### 广告位清单（每页 ≥ 2 个，门户页建议铺满 6–8 个）
| 位置 | 形态 | 文案基调 |
|------|------|----------|
| 顶栏角落 | 一行文字广告 + 「广告」小字 | 理财 / 8%年化 |
| 搜索框下 | 黄底文字广告条 `#fffbe6/#ffe58f` | 本地直播 / 楼盘认筹 |
| 顶部通栏 | 70px 横幅 + 抢购按钮 | 电商大促 |
| 版块之间 | 60px 横幅（插在第 2、4 段后） | 双12 / 在线英语 |
| 右栏方块 | 200px 竖图广告 ×2 | 江景房 / 页游"一刀999" |
| 右下角 | `position:fixed` 弹窗 + ✕ 关闭 | 装修大礼包 |
- 广告必带「广告 / 推广」标注；弹窗可关闭（**关闭后 10–20s 新广告滑入**，见层一加载规则）

### 当年真实站点名库（按类别，生成时优先引用）
- **常用**：百度 淘宝 京东 天猫 微博 QQ空间 优酷 爱奇艺 腾讯网 网易 搜狐 12306 支付宝 人人网 天涯 贴吧 迅雷 360导航 凤凰网 豆瓣 知乎 CSDN
- **视频**：优酷 土豆 乐视 芒果TV PPTV 哔哩哔哩 A站 迅雷看看 六间房 YY 电影天堂 人人影视 快播 暴风影音 56网
- **购物**：淘宝 天猫 苏宁易购 唯品会 聚划算 当当 国美 1号店 糯米 蘑菇街 凡客 返利网 折800 拍拍 聚美优品 乐蜂网
- **小说游戏**：起点 纵横 17K 潇湘 红袖 4399 7k7k 英雄联盟 DNF 梦幻西游 穿越火线 17173 多玩 游民星空 9377 巴士单机
- **音乐**：QQ音乐 酷狗 酷我 网易云 虾米 千千静听 多米 5sing 九酷
- **旅游生活**：携程 去哪儿 途牛 艺龙 同程 驴妈妈 马蜂窝 安居客 链家 58同城 赶集 智联 前程无忧 拉勾 BOSS直聘
- **新闻财经**：新浪 网易 腾讯 凤凰 人民网 新华网 央视网 环球网 东方财富 同花顺 雪球 天天基金 和讯 第一财经
> ⚠️ 时代红线：不出现 2013 后产物（抖音/拼多多/今日头条/小红书晚期形态等）；以 KV 已存档词条优先做自引用内链。

### 配色工具（保证图标色稳定可复现）
```js
// 按站名哈希取调色板色——同名永远同色，不同名色彩分散
function colorOf(name){ let h=0; for(const c of name) h=(h*31+c.charCodeAt(0))&0x7fffffff; return palette[h%palette.length]; }
// palette 取那个年代品牌色：#2b8eea #ff5000 #e1251b #ff0036 #00be06 #fdb933 #6a5acd ...
```

### 时代细节彩蛋（增强"真"感）
- 顶栏**逐秒走字**的日期 + 星期 + 时钟
- 「设为主页」点击弹"工具 → Internet 选项 → 主页"的老式提示
- 底部 `京ICP证030173号` + `© 2010-2016`

### ⚠️ 对层一「色彩规则」的细化（需你确认）
原文：「不允许出现任何渐变色、毛玻璃、阴影」。复刻发现 2010–2013 正是 **Web2.0 光泽拟物按钮**鼎盛期，纯平反而失真。建议细化为：
- **正文 / 链接区 / 分类网格**：保持纯平、实线边框（遵守原规则）
- **按钮 / 广告位 / 快捷图标**：允许时代化的**轻渐变 + 轻阴影**（如蓝色渐变搜索按钮、横幅渐变底、卡片 1px 投影）
- 仍**禁止**：毛玻璃、大模糊柔光、霓虹光晕等明显现代特征

---

## 组件库矩阵：各页面原型的美学范式（SDUI 渲染层的核心资产）

> **定位**：hao123 那节是「导航/门户」这**一种**原型的落地素材。但 2013 的中文网页有许多种长相——论坛、贴吧、空间、游戏、搜索、购物各有各的招牌骨架。本节把它们逐个拆成**可被渲染器复用的组件库**。
>
> **指导原则（用户定调）**：**只要「美学的真」，不要「内容的真」**。LLM 不必把 2013 的事实写对，内容可以随便编；但页面的**视觉骨架、组件形态、配色性格必须到位**。所以美学的负担落在**渲染层**（离线手写、精雕细琢的组件库 + `era.css`），不落在 LLM 临场发挥。
>
> **与生成链路的关系（承接上文 SDUI/IR 方向）**：
> - LLM 只输出**紧凑的页面 IR**（选哪个原型 + 用哪些 block + 填什么数据/文案），不画 CSS、不写整页 HTML。
> - 服务端 `lib/blocks.mjs` / `lib/macros.mjs` 持有每个原型的组件实现，把 IR 展开成像素级到位的 era 页面。
> - 收益：LLM token 量再砍一个数量级（→ 生成 2–4s，绕开 Vercel 10s 墙）；美学富不富只取决于这套组件库做得多细，与单次生成速度解耦。
> - 模板化**不是妥协**：2013 的论坛/贴吧/门户本就是模板驱动（Discuz 默认皮肤、新浪门户版式、贴吧统一壳），高度一致恰恰是那个年代的真实质感。
>
> **每个原型统一记四件事**：① 骨架顺序（自上而下固定节奏）② 招牌组件（最出戏的「那个年代味」）③ 配色 / 性格 ④ IR block 清单（渲染器要实现的部件）。所有原型仍受**层一美学约束**与**广告位 ≥2** 约束。

### A. portal / 导航首页 —— 见上方「设计素材库（hao123 样张）」，此处不重复。

### B. news / 门户新闻（新浪 / 网易 / 搜狐）
- **骨架**：顶栏(日期/天气/通行证登录) → logo+728通栏广告 → **红蓝双色频道导航**(主导航红底白字 + 子频道灰/蓝) → 三栏主体[左:专题导航｜中:**焦点图轮播**+红色头条+要闻列表｜右:排行榜+图片新闻+竖条广告] → 底部版权/友链
- **正文页(article)**：大标题(雅黑 24–30px 粗) → meta条(来源·时间·字号 A+A- ·打印·评论数) → 正文(15px/行高28/段首缩进2em，配图居中带图说) → **「责任编辑：×××」** → 分享条 → **相关新闻**(■蓝链列) → **评论盖楼**(楼层+用户+归属地IP+顶/踩)
- **招牌组件**：焦点图数字轮播、红色加粗头条、**■红蓝项目符号**列表、字号调节条、责任编辑署名、盖楼评论
- **配色/性格**：新浪红 `#CC0000`/网易红，导航深色，链接蓝；信息极密、严肃门户腔
- **IR blocks**：`channel-nav` `focus-slider` `headline` `news-list` `rank-tab`(点击榜/评论榜) `article-body` `comment-floors`

### C. forum / 论坛（Discuz! 默认皮肤）
- **骨架**：顶部窄导航(站群+登录/注册) → logo+横幅广告+站内搜索 → 主导航条(渐变蓝/绿) → **面包屑**(论坛»分区»版块) → 内容区
- **版块列表**：分区折叠条；每行 `[新帖/无新帖图标]` + 版块名(粗)+版规简介 ｜ 今日发帖(红) ｜ 主题数/帖数 ｜ 最后发表(头像缩略+帖标题+时间)
- **帖子列表**：表头(标题｜作者｜回复/查看｜最后发表)；行 = 图标+`[分类][置顶][精华]`标签+标题 + 作者 + 回复数(红)/查看 + 最后回复者/时间；置顶标红
- **帖子内页(楼层)**：左栏 150px **作者信息卡**(头像/用户名/用户组等级图标/积分·威望·金钱/在线时长/注册日/帖子数/发消息·加好友) ｜ 右栏正文(楼层标 **沙发·板凳·#4** + 时间 + UBB正文 + 灰底**引用框** + 表情 + **签名档**虚线分隔) → 底部**快速回复**(UBB工具栏+表情) + 在线会员统计
- **招牌组件**：表格斑马纹布局、左侧作者信息卡、签名档、引用框、`[精][顶]`标签、用户组等级、沙发板凳楼层
- **配色/性格**：Discuz 蓝 `#336699`/绿，浅灰表格；工整、社区感
- **IR blocks**：`forum-nav` `breadcrumb` `board-table` `thread-list` `post-floor`(author-card+body+sig) `quick-reply`

### D. tieba / 贴吧（百度贴吧）
- **骨架**：百度顶导(网页/贴吧选中/知道/图片…+登录) → 「进入贴吧」搜索框 → **吧头banner**(「××吧」+关注/帖子数 + `+关注`蓝按钮 + 签到 + 吧主吧务) → 精品/全部 tab → 主题列表 → 发帖框
- **主题列表**：每行左侧 **蓝色方块回复数** + 标题(可带`[精华]`红标/图片标) + 作者 + 最后回复时间(右灰)；置顶「顶」红标
- **帖子内页**：1 楼大主题 → 楼层卡(头像在左/用户名蓝/等级 + 内容 + **贴吧表情** + 配图 + 「回复(N)·赞·时间」+ **楼中楼**回复)
- **招牌组件**：蓝色回复数方块、关注/签到、贴吧表情包、楼中楼、`[精]`红标、吧头 banner
- **配色/性格**：贴吧蓝(百度蓝系)，白卡灰底；轻松、UGC 感
- **IR blocks**：`baidu-nav` `bar-header` `thread-list`(reply-badge) `post` `sub-reply`

### E. space / 个人空间（QQ空间 / 博客 / 人人网）—— 两种子风
- **E1 QQ空间风(花哨)**：自定义皮肤大图背景 + 顶部装饰条 + 模块[主人寄语·心情说说·**相册格子**·留言板·**音乐播放器**(自动播放/歌名滚动)·**访客足迹**头像列·黄钻等级图标]；拟人化、闪图 GIF、鼠标特效
- **E2 博客风(新浪/网易博客)**：博客名+副标题签名 → 三栏[侧栏:个人资料卡·公告·**文章分类**·最近访客头像格·**友情链接**·日历存档·**访问计数器** ｜ 主栏:博文列表(标题蓝链+时间+摘要+图+阅读全文+标签/分类/评论数)]
- **招牌组件**：侧栏小工具堆叠、访问计数器、最近访客头像格、心情说说墙、音乐播放器占位、闪图装饰、友情链接、「加关注/发纸条」
- **配色/性格**：多变；博客常浅蓝/粉，空间花哨；强装饰、个人化
- **IR blocks**：`space-header` `profile-card` `sidebar-widgets`(notice/category/visitors/counter/links/calendar) + 主体任选 `blog-list` / `mood-wall` / `album-grid` / `guestbook` / `music-player`

### F. game-portal / 游戏站（4399 / 7k7k / 页游门户）
- **骨架**：密集游戏分类导航+登录 → logo+搜索+**大 banner**(页游「一刀999·是兄弟就来砍我」红金渐变+立即开始) → 快捷分类宫格(休闲/敏捷/射击/棋牌/养成/双人…) → **游戏缩略图网格**(缩略图+游戏名+hover「开始游戏」+HOT/NEW标，多行密集) + 排行榜(热门/最新/好评) + 专题 → 右栏页游竖图广告×2
- **招牌组件**：密集游戏缩略图网格、「开始游戏」按钮、HOT/NEW 徽章、页游土豪金广告、分类宫格
- **配色/性格**：4399 偏亮橙绿、页游偏暗或土豪金红；密集、躁动
- **IR blocks**：`game-nav` `hero-banner` `category-grid` `game-grid` `rank-list`

### G. game-play / 游戏界面（**唯一需要真实 JS 逻辑**）
- **骨架**：游戏标题+星级评分+「全屏·重玩」 → 居中**可玩游戏区** → 操作说明+攻略文 + 相关游戏推荐网格 + 玩家评论；四周保持门户密度(导航/广告)
- **关键做法**：渲染器**内置几款小游戏实现**(贪吃蛇/打地鼠/弹球/2048/连连看)，IR 只用 `game-canvas` 指定 `kind` → **LLM 完全不写游戏代码**，速度极快且「真的能玩」(满足层二「游戏页必须可玩」要求)
- **招牌组件**：嵌入式可玩 canvas、星级评分、操作说明、相关游戏、攻略文
- **IR blocks**：`game-canvas`(kind: snake/whack/pong/2048/…) `game-meta` `guide-text` `related-games`

### H. search / 搜索结果（百度）
- **骨架**：小 logo + 搜索框(已填词)+「百度一下」 → 结果类型 tab(网页/新闻/贴吧/知道/图片/视频/地图/百科/文库) → 左主结果区 + 右栏(推广/百科卡/相关人物) → 底部相关搜索网格 + **百度分页**
- **结果条目**：标题(蓝链，**关键词标红**) + 绿色 URL+「百度快照」+时间 + 摘要(2行，关键词标红)；部分带**「推广」底色标注**
- **招牌组件**：蓝标题红关键词、绿 URL+快照、推广标注、相关搜索网格、`上一页 1 2 3…10 下一页`(当前页红)
- **配色/性格**：百度蓝绿；极简克制、列表流
- **IR blocks**：`search-box` `tab-bar` `result-list`(result-item) `promo-item` `paginator` `related-search`
- **注**：本原型对应路由 `/search?q=`，层三规定**不缓存、每次实时生成**——更要靠 IR 把生成压到极快。

### I. shop / 购物（淘宝 / 京东 商品页）
- **商品页骨架**：分类面包屑 → 左[主图大+缩略图行+放大镜] ｜ 右[标题+促销语+**红色大¥价格**+划线原价+销量/评价数+**规格色块**(颜色/尺码)+数量+**「立即购买」橙·「加入购物车」红**+正品/包邮/7天退承诺] → 店铺信誉卡 → 详情/评价 tab+宝贝详情长图 → **猜你喜欢**网格
- **列表页**：商品网格卡(图+标题+红价+销量+店铺+地区)
- **招牌组件**：红色大价格、橙红购买按钮、规格色块、销量/评价、店铺信誉、猜你喜欢
- **配色/性格**：淘宝橙 `#FF6600`/红、京东红；促销感、转化导向
- **IR blocks**：`shop-breadcrumb` `product-gallery` `buy-box` `shop-card` `detail-tabs` `product-grid`

### 原型路由推断（沿用层二「AI 根据 path 自行判断类型」）
| path 语义示例 | 原型 |
|---|---|
| `/`、`/hao`、`/dh` | A portal |
| `/news/...`、人物/事件词条 | B news |
| `/bbs/...`、`/forum/...`、`xx社区` | C forum |
| `/tieba/xx`、`xx吧` | D tieba |
| `/space/user/xx`、`/blog/...`、`/u/xx` | E space |
| `/game`、`/4399`、游戏下载/门户 | F game-portal |
| `/game/xx`、`/play/xx`、具体游戏 | G game-play |
| `/search?q=` | H search |
| `/item/xx`、`/goods/...`、商品名 | I shop |

> ⚠️ 清单**可扩展**：后续可补 video(优酷/土豆播放页)、music(QQ音乐/酷狗)、map、wiki(百度百科)等原型，统一按「骨架 / 招牌组件 / 配色性格 / IR blocks」四件套增补。

---

## 踩坑记录

### 🔧 [2026-06-08] Next 配置键放错层级

**现象**: `next dev` 启动报 `⚠ Unrecognized key(s) in object: 'outputFileTracingIncludes'`。
**根因**: Next 14.2 该键属于 `experimental` 命名空间，写在了 `nextConfig` 顶层（14.x 与 15.x 位置不同）。
**修复**: `next.config.mjs` 把 `outputFileTracingIncludes` 移到 `experimental` 下。
**关键点**: 升级/查文档时注意配置键的版本归属；14.x 多数 tracing/打包键在 `experimental`，15.x 才提到顶层。

### 🔧 [2026-06-08] Next 遥测跨盘崩溃 EXDEV

**现象**: `next dev` 启动即崩 `Error: EXDEV: cross-device link not permitted, rename '...nextjs-nodejs\Config\config.json.xxx' -> 'config.json'`。
**根因**: Next 遥测把配置写到 `%AppData%` 时用 `renameSync` 跨设备/挂载点改名，Windows 上该盘与临时文件不同卷即失败。
**修复**: 启动加环境变量 `NEXT_TELEMETRY_DISABLED=1`，绕过遥测写盘。
**关键点**: 凡是“启动即崩在 rename/telemetry”的报错，先关遥测（`NEXT_TELEMETRY_DISABLED=1`）；不要用 `next telemetry disable`（它本身也会触发同一次写盘）。

### 🔧 [2026-06-08] 路由间内存状态不共享

**现象**: `/api/generate` 写入内存 KV 后，`/api/stats` 读到 `count:0`；但同一路由内 cache MISS→HIT 正常。
**根因**: Next 对每个 route 单独打包，`lib/kv.mjs` 顶层 `const _mem = new Map()` 在各路由 bundle 里各实例化一份，跨路由不共享。
**修复**: 改为 `globalThis` 单例：`const _mem = (globalThis.__vibe_mem ||= new Map())`（`lib/kv.mjs`）。
**关键点**: Next/serverless 下任何跨路由共享的进程内状态（缓存、连接池、计数器）都必须挂 `globalThis` 单例，否则各 bundle 各一份；生产应直接换外部存储（Vercel KV / Redis），内存方案仅 dev 兜底。

### 🔧 [2026-06-08] build 与 dev 同跑污染 .next 缓存

**现象**: dev server 运行中手动执行 `next build`，之后访问任意路由报 `Error: Cannot find module './948.js'`，页面白屏。
**根因**: `next build` 覆写了 `.next/server/webpack-runtime.js` 等文件，但 dev server 进程持有的内存引用仍指向旧 chunk id，两套产物不兼容。
**修复**: 杀掉 dev server → `rm -rf .next` → 重新 `npm run dev`。
**关键点**: `next build` 和 `next dev` 绝不能在同一目录同时运行；需要验证生产构建时，先停 dev server，build 完再重启 dev。CI 上二者也要串行而非并行。

### 🔧 [2026-06-08] Supabase 魔法链接 otp_expired

**现象**: 邮件链接点击后跳回 `/login.html?err=auth#error_code=otp_expired`，始终无法登录。
**根因**: 代码把 `emailRedirectTo` 指向 `/auth/callback`（PKCE `exchangeCodeForSession` 流程），但 Supabase 默认邮件模板发的是 `token_hash` 链接；两套流程不匹配，且邮件安全扫描器可能提前"点击"链接消耗 OTP。
**修复**: 新建 `app/auth/confirm/route.js`（`verifyOtp({ type, token_hash })`），将 `emailRedirectTo` 改为 `/auth/confirm?next=...`；Supabase 后台 Redirect URLs 同步换成 `/auth/confirm`。
**关键点**: Supabase SSR 邮件登录推荐用 `token_hash + verifyOtp`（对扫描器更稳健），PKCE `?code` 方式留给 OAuth 社交登录；两者回调路由不同，不能混用。

### 🔧 [2026-06-13] MiMo UltraSpeed 接入：reasoning 模型必须显式关思考

**现象**: 直接调 `mimo-v2.5-pro-ultraspeed` 时 `content` 为空，token 全部烧在 `reasoning_content` 上，`finish_reason=length`。
**根因**: UltraSpeed 是 reasoning 模型，默认开思考；OpenAI 兼容接口下思考产物不计入 `content`。
**修复**: 请求体加 `thinking: { type: "disabled" }`（`lib/llm.mjs` 的 mimo provider `extraBody`）。
**关键点**: ① base URL `https://api.xiaomimimo.com/v1`，model id 用 `/v1/models` 实测确认。② 缓存命中字段是 `usage.prompt_tokens_details.cached_tokens`（DeepSeek 是 `prompt_cache_hit_tokens`），多 provider 计量要逐家适配。③ 实测关思考后整页生成 5–7s、稳定 `finish_reason=stop`，prompt 缓存第二次起命中 ~96%。

### 🔧 [2026-06-08] 跨浏览器登录：弃用魔法链接 relay-bridge，统一 OTP 验证码

**现象**: 魔法链接点击后常落在邮件客户端内置浏览器，登录态停在那个浏览器里，目标浏览器（Edge）拿不到会话。为此造了 relay-bridge（铸 relay 码存 KV → 用户手动复制链接到目标浏览器），UX 极差。
**根因**: 魔法链接**天生不跨浏览器**——链接在哪个浏览器打开，会话就落在哪。relay 桥是在硬扛这个根本缺陷，是反模式。
**修复**: 彻底删除魔法链接 + relay-bridge 整套（`app/auth/{callback,confirm,relay,store-tokens}` + `public/auth/{bridge,callback-client}.html` + `lib/kv.mjs` 的 `setRelay/takeRelay`），统一到**邮箱 OTP 验证码**：`signInWithOtp` **不传 `emailRedirectTo`** → 发 6 位码 → 用户在当前浏览器手输 → `verifyOtp` → `/auth/set-session` 写 SSR Cookie。auth 链路从 6 文件缩到 2 文件（`set-session` + `login.html`）。
**关键点**: ① 验证码手输，在哪发起就在哪完成，**天然跨浏览器**，无需任何中转。② 发码而非链接的开关在 **Supabase 邮件模板**：Magic Link 模板正文用 `{{ .Token }}` 而非 `{{ .ConfirmationURL }}`，不改这里仍发链接。③ 额度：内置邮件 2 封/小时（不可用于生产），接 Resend 自定义 SMTP 升到 30 封/小时（可在 Rate Limits 上调）；前端再加 60s 发送冷却避免触发 429。
