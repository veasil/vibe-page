<div align="center">

# 幻觉导航网 Vibe-Page

**一座由观察者坍缩而成的图书馆**

一个停在十三年前的中文互联网实验

[线上入口](https://vibe-page.ibibb.cc/) · [离线样例](#离线样例) · [工程实现](#工程上的考量)

</div>

## 十三年前的互联网，从一条路径开始

推开一扇门，你可能看到一条新闻、一个论坛、一座个人空间。页面像是来自记忆里的中文互联网，又有一点错位。

**一条路径首次生成时，结果被保存。** 此后的访客打开同一路径，看到的是同一个版本。顺着页面里的链接走，你会遇到已经封存的页面，也可能成为另一条路径的第一个访客。

- **浏览**：从首页输入路径，或选择已有入口。已封存页面可以直接浏览。
- **探索**：生成新页面需要登录，受每日额度限制。首页也会提供本期彩蛋线索。
- **阅读边界**：页面内容由模型生成，属于虚构材料，请勿作为历史资料引用。

## 离线样例

仓库内附有一个门户样例。下载仓库后直接用浏览器打开 [`demo/index.html`](./demo/index.html)，即可预览页面样式。样例由 [固定输入](./demo/sample-llm-output.html) 渲染，可在仓库根目录运行以下命令重新生成：

```sh
npm run demo:render
```

样例使用仓库内的静态资源和固定输入，无需配置模型密钥。启动完整应用的步骤见 [本地运行](#本地运行)。

## 工程上的考量

把上面的概念落进代码，最关键的一步是把「观察者效应」做成一条硬规则——并让它同时解决工程问题：

- **协商真实 = 首写锁定。** 每个路径首次生成后即写入存储、永不覆盖。这既是世界观（坍缩成确定），也一并解决了**一致性**（所有人看到同一份）和**成本**（同一路径只生成一次，之后命中缓存零成本）。
- **生成内容是不可信 UGC。** 任意用户可诱导模型产出任意内容、且会被永久封存对所有人可见。因此：① 渲染在 **沙箱 iframe**（无 `allow-same-origin`），脚本碰不到主站登录态；② 入库前剥掉 `script/iframe/on*/javascript:` 等危险标签；③ 关键词黑名单在生成与缓存**之前**拦截违规输入/产出；④ 每日配额兜底防烧钱。
- **生成有延迟（约 5–7s）。** 等待期用那个年代风格的「假加载」骨架占位；产出后把生成时刻**冻结**进页面（时间戳），令所有访客一致。
- **极致压缩 LLM 输出。** 模型只写 `<main>` 片段、用宏占位符（`[[LINKS:...]]` 等），样式与交互由外壳的 `era.css` + `runtime.js` 接管——输出量约为整页手写的 1/35；再叠加按天稳定的 prompt 前缀以命中上下文缓存。
- **彩蛋判定前置。** 放在缓存与配额**之前**：本期命中谜底 → 返回彩蛋页（不计费、覆盖普通缓存）；期一过，该词自动变回普通页。谜底只存服务端。

## 架构 · 三层约束

完整设定与踩坑见 [`CLAUDE.md`](./CLAUDE.md)。

- **层一 · 美学（注入所有 prompt 的硬约束）** —— 信息密度、限定字体/配色、必备广告位、JS 编排的假加载。AI 可自由发挥结构，但必须呼吸在这层空气里。落地素材：hao123 门户范式 + 各原型（news/forum/tieba/space/game/search/shop）组件库矩阵。
- **层二 · 内容** —— 全局时代锚点（现实今天 − 13 年，随日期滚动）+ 时代文化参照；AI 据路径语义自判页面类型。
- **层三 · 存储** —— Upstash KV（协商真实页库 / 配额 / 统计 / 彩蛋）+ Supabase（认证 / 计量 / 反馈）。

## 技术栈

Next.js 14（App Router）· Vercel · Upstash Redis · Supabase（邮箱 OTP）· LLM（小米 **MiMo** UltraSpeed）· Resend（自定义 SMTP）。

## 项目结构

```
app/
  page.jsx               根路径 → 跳落地页
  layout.jsx
  api/
    generate/            生成总闸：鉴权 → 配额 → 黑名单 → 彩蛋 → 缓存 → 锁定 → 计量
    egg/clue/            公开线索（谜底不下发）
    admin/               控制台后端（统计 / 删词条 / 清缓存 / mock 开关 / 彩蛋管理）
    config/ stats/ archive/
  auth/set-session/      OTP 验证成功后写 SSR Cookie
lib/
  generate.mjs           生成编排（核心链路）
  llm.mjs                多 provider LLM 客户端 + mock 降级
  kv.mjs                 KV 封装（协商真实 / 配额 / 统计 / 删除）
  prompt.mjs             system prompt 组装（注入三层约束 + 时代锚点）
  macros.mjs · blocks.mjs  宏展开 + 组件库素材
  shell.mjs              页面外壳（顶栏 / 搜索 / 页脚 + 生成时间戳）
  egg.mjs                彩蛋层（期号 / 判定 / 发现 / 线索 / 彩蛋页）
  blocklist.mjs          关键词黑名单（UGC 止血）
  flags.mjs              运行时开关（强制 mock 登录等）
  auth.mjs · email.mjs
prompts/
  aesthetic.md  层一·美学    era.md  层二·时代    output-contract.md  输出契约（最高优先级）
public/
  landing / app / login / admin .html  +  about / archive / feedback / help .html
  era.css                全站样式      runtime.js  客户端运行时（时钟/搜索/内链拦截/加载编排/时间戳）
utils/supabase/          SSR / 浏览器 Supabase 客户端
CLAUDE.md  设计与踩坑全集      DEPLOY.md  部署清单
```

## 本地运行

```bash
npm ci
cp .env.local.example .env.local   # 在 PowerShell 可用 Copy-Item；本地配置按需填写
npm run dev                         # http://localhost:3000
```

## 部署

推到 GitHub，Vercel 连仓库自动部署。**关键**：Vercel 项目 Framework Preset 必须为 **Next.js**（否则只发静态资源、API 函数全 404）。详见 [`DEPLOY.md`](./DEPLOY.md)。

## 环境变量

```bash
LLM_PROVIDER=mimo
MIMO_API_KEY=                         # 不配则回退 mock，页面非真生成
DEEPSEEK_API_KEY=                     # 可选备选
KV_REST_API_URL=                      # Upstash
KV_REST_API_TOKEN=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
GEN_DAILY_QUOTA=20
ADMIN_TOKEN=                          # /admin 令牌；生产必配，否则后台一律拒绝
```

## 路由

```
/  落地页    /app.html  主应用（沙箱壳 + #/任意路径）    /login.html  OTP 登录    /admin.html  控制台
/api/generate  生成总闸    /api/egg/clue  线索    /api/admin  后台    /api/config · /api/stats · /api/archive
```

## 控制台 `/admin`

导游 BIBB 的工作台（填 `ADMIN_TOKEN` 进入）：LLM provider / 登录模式 / KV 后端 / 生成统计（次数·token·成本）/ 配额用量 / 已封存词条（逐条下架重生成）/ 强制 mock 登录开关 / 本期彩蛋管理。

## Roadmap

- [ ] 彩蛋页正式版式 & 纪念徽章收藏册
- [ ] auto 彩蛋助手（按当前时代窗口让 LLM 出候选）
- [ ] 内容机审 API（替/补关键词黑名单）+ 全站成本熔断
- [ ] SDUI/IR 组件库（LLM 只出 IR、渲染器拼页，把生成压到 2–4s）
- [ ] 手机端浏览适配

---

<div align="center">

*这里仍然庞大……*

Curated by **BIBB**

</div>
