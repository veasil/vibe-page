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
DEEPSEEK_API_KEY                      = sk-...           （你的 key）
NEXT_PUBLIC_SUPABASE_URL              = https://yxuqsgtbkljkbsecansn.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY  = sb_publishable_...
GEN_DAILY_QUOTA                       = 20
```
> `NEXT_TELEMETRY_DISABLED` 不用加（那是本地 Windows 跨盘 bug，Linux 无此问题）。

## 3. Upstash（替代 Vercel KV）
两种方式二选一：
- **A 一键集成**：Vercel → Storage → Marketplace → Upstash → 连到本项目，
  它会自动注入 `KV_REST_API_URL` / `KV_REST_API_TOKEN`（代码已兼容这套命名）。
- **B 手动**：把你 `.env.local` 里那组 `KV_REST_API_URL` / `KV_REST_API_TOKEN` 原样填进环境变量。

## 4. Supabase 后台（加线上域名，不是改）
部署拿到域名后（如 `https://vibe-page.vercel.app`）：
- Authentication → URL Configuration → **Redirect URLs** 追加：
  ```
  https://<你的vercel域名>/auth/callback
  ```
  （本地那条 `http://localhost:3000/auth/callback` 保留，两条共存）
- **Site URL** 改成 `https://<你的vercel域名>`
> 代码用 `location.origin` 自动适配域名，**不需改任何代码**。

## 5. 数据库表
若还没跑过：Supabase → SQL Editor 执行 `supabase/schema.sql`（建 generations / feedback + RLS）。

## 6. 部署 & 验证
Deploy 后访问线上域名：
- `GET /api/config` → 应返回 `"authMode":"supabase"`
- 打开首页 → 输邮箱 → 收信点链接 → 进 `/app.html` 看真实生成
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
