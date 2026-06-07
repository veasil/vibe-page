# 开发文档 · 协商真实 · 幻觉导航网

> 配套阅读：`CLAUDE.md`（概念 / 三层架构 / 美学约束系统 / hao123 设计素材库）。
> 本文只讲**怎么动手做**：搭建、目录、数据流、接口契约、本地调试、部署、验收。

---

## 0. 一句话回顾

用户访问任意路径 → 命中 KV 缓存就直接返回；没命中就调 LLM **实时流式生成整页 HTML** → 写入 KV 永久固定 → 返回。**第一次生成即成为该路径的"真实"**。

---

## 1. 技术栈

| 层 | 选型 | 说明 |
|----|------|------|
| 框架 | **Next.js 14（App Router）** | catch-all 路由 + Route Handler 流式输出 |
| 运行时 | Node / Edge | `/api/generate` 用 Edge runtime 跑流式 |
| 内容存储 | **Vercel KV**（Redis） | 协商真实：`page:*` 写入即不可覆盖 |
| 反馈存储 | **Supabase**（Postgres） | `feedback` 表 |
| LLM | **DeepSeek**（`deepseek-chat`），备选 Kimi | OpenAI 兼容协议，`base: https://api.deepseek.com/v1` |
| 部署 | **Vercel** | KV / 环境变量原生集成 |
| 语言 | TypeScript | — |

> 不引入 UI 框架 / Tailwind：**生成出来的页面是纯手写 HTML+内联 CSS**，框架只负责"壳"。

---

## 2. 从零搭建

```bash
# 1) 脚手架
npx create-next-app@14 vibe-page --ts --app --no-tailwind --no-src-dir
cd vibe-page

# 2) 依赖
npm i @vercel/kv openai @supabase/supabase-js

# 3) 环境变量（复制后填值）
cp .env.example .env.local
```

`.env.local`（对应 `CLAUDE.md` 环境变量）：
```
DEEPSEEK_API_KEY=
KV_REST_API_URL=
KV_REST_API_TOKEN=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

```bash
npm run dev      # 本地 http://localhost:3000
```

> Vercel KV 凭据：Vercel 控制台建一个 KV 库后，`vercel env pull .env.local` 自动拉取。

---

## 3. 目录结构（建议）

```
vibe-page/
├── app/
│   ├── page.tsx                 # 首页：KV-first 读 'home'，无则生成
│   ├── [...path]/page.tsx       # catch-all 内容页：KV-first 读 page:<slug>
│   ├── search/page.tsx          # 搜索结果页：每次实时生成，不缓存
│   ├── feedback/page.tsx        # 反馈页
│   ├── api/
│   │   ├── generate/route.ts    # 流式生成（Edge runtime）
│   │   └── feedback/route.ts    # POST → 写 Supabase
│   └── layout.tsx               # 最小壳：注入运行时脚本 runtime.js
├── lib/
│   ├── kv.ts                    # KV 读写封装（含"写入即锁定"）
│   ├── llm.ts                   # DeepSeek 客户端 + 流式封装
│   ├── prompt.ts                # 三层 Prompt 组装（核心）
│   ├── slug.ts                  # path ↔ slug 规范化
│   └── supabase.ts              # Supabase 客户端
├── public/
│   ├── runtime.js               # 前端编排：加载动画/内链/广告队列/反馈
│   └── reference/hao123.html    # 美学样张（开发参照，不上线路由）
├── prompts/
│   ├── aesthetic.md             # 层一 美学约束（注入所有 prompt）
│   └── era.md                   # 层二 2013 时代约束
├── CLAUDE.md
├── DEVELOPMENT.md
└── .env.local
```

> 把 `hao123.html` 移到 `public/reference/` 作为样张；`prompts/aesthetic.md` 直接引用 `CLAUDE.md` 的「设计素材库」内容。

---

## 4. 核心数据流

```
浏览器 GET /game/lol
        │
        ▼
[...path]/page.tsx ──► lib/kv.ts: get('page:game/lol')
        │                         │
        │  命中 ◄─────────────────┘ 直接 dangerouslySetInnerHTML 返回
        │
        │  未命中
        ▼
fetch /api/generate { type:'page', path:'game/lol', existingSlugs:[...] }
        │
        ▼
lib/prompt.ts 组装 → lib/llm.ts 流式调 DeepSeek
        │
        ▼
流式 HTML ──► 边收边渲染（首屏更快）
        │
        ▼
收完 ──► lib/kv.ts: setIfAbsent('page:game/lol', html)   ← 协商真实，不可覆盖
```

关键约束：
- **写入用 `setIfAbsent`（SET NX）**，并发首访也只锁定第一份。
- **`/search` 不缓存**：搜索结果每次实时生成。
- **`/` 首页** key = `home`，可由运营手动重置；内容页一经生成不动。

---

## 5. 路由与 API 契约

### 5.1 页面路由
| 路由 | 行为 | 缓存 |
|------|------|------|
| `/` | 读 `home`，无则生成首页 | KV-first |
| `/[...path]` | `slug = path.join('/')`，读 `page:<slug>` | KV-first，写入即锁定 |
| `/search?q=` | 实时生成结果页 | 不缓存 |
| `/feedback` | 静态反馈表单 | — |

### 5.2 `POST /api/generate`（Edge，流式）
请求：
```ts
{
  type: 'home' | 'search' | 'page',
  path?: string,            // type=page
  query?: string,           // type=search
  existingSlugs: string[]   // 从 kv.keys('page:*') 读，注入自引用内链
}
```
响应：`text/html` 流（`ReadableStream`），**纯 HTML，无 markdown、无解释**。

### 5.3 `POST /api/feedback`
```ts
{ page_url: string, slug?: string,
  type: 'too_obvious'|'too_real'|'content_issue'|'other',
  comment?: string }
// → 200 { ok: true }
```

---

## 6. 数据模型

### Vercel KV
```
home                     → string(html)   首页
page:<slug>              → string(html)    内容页，setIfAbsent 锁定
page:*                   → kv.keys() 取全部 slug（注入 prompt + 首页计数）
```

### Supabase
```sql
create table feedback (
  id uuid default gen_random_uuid() primary key,
  page_url text not null,
  slug text,
  type text check (type in ('too_obvious','too_real','content_issue','other')),
  comment text,
  created_at timestamptz default now()
);
```

---

## 7. Prompt 组装（`lib/prompt.ts` — 项目灵魂）

三段拼接，顺序固定：
```
[层一 美学约束]  prompts/aesthetic.md（信息密度/字体/色彩/广告/加载行为 + hao123 素材库）
      +
[层二 时代约束]  prompts/era.md（今天是 2013-06-08，文化参照与时代红线）
      +
[本次任务]       页面类型推断规则 + path/query + existingSlugs 自引用清单 + 输出格式
```

页面类型由 AI 按 path 语义自判（见 `CLAUDE.md` 表：news/game/forum/space/portal）。

输出格式硬约束（务必写进 prompt 尾部）：
- 输出**完整 HTML**（含 `<style>` 内联 CSS、`<script>` 内联 JS），**不要 markdown、不要解释**
- 含 4–6 个内链：`<a class="inner-link" data-slug="词条名">文字</a>`
- 每页 ≥ 2 个广告位（门户页按素材库铺 6–8 个）
- 所有 CSS 必须符合层一约束（渐变/阴影按素材库「细化条」执行）

---

## 8. 前端编排（`public/runtime.js`）

LLM 产出的页面本身是静态的；"活"的部分由壳里注入的 `runtime.js` 统一接管：

1. **加载编排**（模拟 2013 渲染节奏，见 `CLAUDE.md` 加载规则）
   - 0ms 骨架 → 300–600ms 图片 pop in（个别先破损图标再"加载成功"）→ 800–1200ms 广告转圈后替换
2. **内链导航**：拦截 `.inner-link` 点击 → `router.push('/' + data-slug)`（不刷新整页）
3. **广告队列**：浮层广告 ✕ 关闭后，`setTimeout` 10–20s 让新广告从角落滑入
4. **反馈入口**：全局"这页太假/太真"按钮 → `POST /api/feedback`

> `runtime.js` 用事件委托作用于 `dangerouslySetInnerHTML` 注入的 DOM，避免每页重复内联脚本。

---

## 9. 本地开发（不接外部服务）

为了离线/省 token 调试，三个外部依赖都要可降级：

| 依赖 | Mock 方案 |
|------|-----------|
| LLM | `MOCK_LLM=1` 时 `lib/llm.ts` 直接吐 `public/reference/hao123.html`，跑通整条流式链路 |
| KV | 无 KV 凭据时 `lib/kv.ts` 回退到内存 `Map`（重启即清空） |
| Supabase | 无凭据时 `lib/supabase.ts` 把 feedback 写 `console.log` |

调试入口：
- `GET /game/test` 验证 catch-all + 生成 + 缓存
- 第二次访问同路径应**秒回**（命中 KV/内存），据此验证"协商真实"是否生效

---

## 10. 部署（Vercel）

```bash
vercel link
vercel env add DEEPSEEK_API_KEY        # 逐个加齐 .env.local 里的变量
# KV 在 Vercel 控制台 Storage 里创建并 Connect 到本项目（自动注入 KV_REST_API_*）
vercel --prod
```
注意：
- `/api/generate` 设 `export const runtime = 'edge'` + 流式响应
- LLM 单次调用可能 > 默认超时，确认函数 `maxDuration` 足够（或用流式持续推送保活）

---

## 11. 开发规范

- **TS 严格模式**；`lib/*` 必须可在无外部凭据下运行（降级到 mock）
- 改 prompt 后，至少回归 5 个路径：`/`、一条 news、一条 game、一条 forum、一条 space
- KV 写入只走 `setIfAbsent`，**禁止**任何覆盖 `page:*` 的代码路径（破坏"协商真实"）
- 任何"现代特征"（毛玻璃/霓虹/2013 后产物）视为 bug，按时代红线处理
- 踩坑修复后在 `CLAUDE.md` 追加记录（说"记录一下"触发）

---

## 12. 验收清单（每次大改自测）

- [ ] 首次访问新路径能流式生成、且**边收边渲染**
- [ ] 二次访问同路径**秒回**且内容**逐字一致**（锁定生效）
- [ ] `/search?q=xxx` 每次结果**不同**（不缓存）
- [ ] 每页 ≥ 2 广告位，浮层可关闭且 10–20s 后新广告滑入
- [ ] 内链点击跳转正确，且目标路径同样走 KV-first
- [ ] 反馈提交成功写入 Supabase（或 mock 日志）
- [ ] 页面无渐变/阴影越界（除素材库允许的按钮/广告/图标）
- [ ] 无 2013 之后的站点 / 产品 / 热词出现

---

## 13. 里程碑

1. **M1 骨架跑通**：脚手架 + `/[...path]` + `/api/generate`（接 `MOCK_LLM` 吐 hao123）
2. **M2 接真模型**：DeepSeek 流式 + prompt 三层组装 + 五类页面验收
3. **M3 协商真实**：KV `setIfAbsent` + existingSlugs 自引用内链闭环
4. **M4 活起来**：`runtime.js` 加载编排 / 广告队列 / 内链 SPA 导航
5. **M5 反馈闭环**：Supabase feedback + 反馈页 + 全局入口
6. **M6 上线**：Vercel 部署 + 超时/保活 + 时代红线回归
