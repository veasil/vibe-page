# 部署清单 · Vercel

> 平台：Vercel（真 serverless，Next 原生）。状态全在外部（Upstash / Supabase / DeepSeek），
> 平台只是壳。本地已验证：`next build` 通过，prompts 已随函数打包（nft 追踪命中）。

---

## 0. 前置
- 代码推到 GitHub（Vercel 连 git 自动部署）——目前仓库还没提交，先 `git init && commit && push`
- 或用 CLI 直传：`npm i -g vercel && vercel`

## 1. 导入项目
Vercel Dashboard → Add New → Project → 选这个仓库 → Framework 自动识别 Next.js → 先别急着 Deploy，先配环境变量（下一步）。

## 2. 环境变量（Project Settings → Environment Variables）
逐条加（Production + Preview 都勾）：
```
# —— LLM（主用 MiMo；不配 key 会回退 mock，页面不是真生成）——
LLM_PROVIDER                          = mimo
MIMO_API_KEY                          = sk-...            （小米 MiMo key）
DEEPSEEK_API_KEY                      = sk-...            （可选备选；二者至少配一个）
# —— Supabase（邮箱 OTP 登录）——
NEXT_PUBLIC_SUPABASE_URL              = https://yxuqsgtbkljkbsecansn.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY  = sb_publishable_...
# —— 配额 ——
GEN_DAILY_QUOTA                       = 20
# —— 开发者控制台 /admin 访问令牌（关键）——
ADMIN_TOKEN                           = <一串随机串>
```
> ⚠️ `ADMIN_TOKEN`：生产环境（Vercel `NODE_ENV=production`）下，**没配 `ADMIN_TOKEN` 则 `/api/admin` 一律拒绝**（安全设计，防裸奔被删库/翻鉴权）。要用 `/admin` 控制台就必须配，并在 admin 页顶部输入框填同一串。生成方法：`node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`。
> `ALLOW_AUTH_OVERRIDE` 默认不配——它是把"强制 mock 登录"开关放开到生产的逃生阀，**生产切勿设为 1**（否则线上鉴权可被降级）。
> `NEXT_TELEMETRY_DISABLED` 不用加（那是本地 Windows 跨盘 bug，Linux 无此问题）。

## 3. Upstash（替代 Vercel KV）
两种方式二选一：
- **A 一键集成**：Vercel → Storage → Marketplace → Upstash → 连到本项目，
  它会自动注入 `KV_REST_API_URL` / `KV_REST_API_TOKEN`（代码已兼容这套命名）。
- **B 手动**：把你 `.env.local` 里那组 `KV_REST_API_URL` / `KV_REST_API_TOKEN` 原样填进环境变量。

## 4. Supabase 后台（OTP 验证码登录，关键配置）
登录走**纯 OTP 验证码**（邮件发 6 位数字码，用户在当前浏览器手输 → 天然跨浏览器）。
不再用魔法链接/回调，**不需要配 Redirect URLs**。需配三处：

- **① 邮件模板发码而非链接**（最关键）：Authentication → Email Templates → **Magic Link** 模板，
  正文改用 `{{ .Token }}`（发 6 位验证码），而非 `{{ .ConfirmationURL }}`（发链接）。
  例：`您的登录验证码是：<b>{{ .Token }}</b>，10 分钟内有效。`
  > 不改这里仍会发链接，验证码流收不到码。
- **② OTP 过期时长**：Authentication → Providers → Email → **Email OTP Expiration** 设 600~3600s。
- **③ 自定义 SMTP（额度）**：Authentication → SMTP Settings 启用 **Resend**（内置邮件仅 2 封/小时，不可用于生产）。
  启用后初始 30 封/小时，按需在 **Rate Limits** 页上调。
- **Site URL** 改成 `https://<你的vercel域名>`（仅用于邮件文案/品牌，不影响 OTP 流）。
> 登录全程不依赖回调域名，**不需改任何代码**。

## 5. 数据库表
若还没跑过：Supabase → SQL Editor 执行 `supabase/schema.sql`（建 generations / feedback + RLS）。

## 6. 部署 & 验证
Deploy 后访问线上域名：
- `GET /api/config` → 应返回 `"authMode":"supabase"`
- 打开首页 → 输邮箱 → 收信抄 6 位验证码 → 输入 → 进 `/app.html` 看真实生成
  （跨浏览器验证：在 A 浏览器发码，把码抄到 B 浏览器输入，应照样登录成功）
- 第二次访问同路径应秒回（Upstash 缓存命中）

---

## 关键注意
- **函数时长**：真实生成 ~32s。已在 `app/api/generate/route.js` 设 `maxDuration = 60`。
  Hobby 上限 60s（够用但没冗余）；若偶发超 60s，升级 Pro（上限 300s）或做流式。
- **冷启动**：serverless 首次请求有冷启动延迟，叠加 32s 生成，首访体感偏慢——
  这正是「流式渲染」要解决的（待办）。
- **成本**：每个**新路径**生成一次 ~$0.001–0.004；浏览已存页面零成本（Upstash 命中）。
  配额 20/人/天兜底；建议尽快补「全局当日花费熔断」。
- **密钥安全**：`.env.local` 已被 gitignore，不会进仓库；线上密钥只在 Vercel 面板。
  `SUPABASE_SERVICE_ROLE_KEY` 全程没用到（计量走用户会话 + RLS），无需配置。

## 待办（上线后迭代）
- [ ] DeepSeek 流式渲染（改善 32s 体感 + 规避 60s 上限）
- [ ] 全局成本熔断（聚合 generations 当日 cost）
- [ ] prompt 遵从度调优（让模型多用宏，避免 max_tokens 截断）
- [ ] `/api/feedback` + 反馈入口接 feedback 表
