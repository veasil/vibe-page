# 架构补遗 · 生成效率 / 成本 / 登录安全

> 配套：`CLAUDE.md`（概念+美学）、`DEVELOPMENT.md`（工程）、`public/era.css`（组件框架）。
> 本文解决三件事：① 让 LLM 输出尽量小（快+省）② 成本管理 ③ 落地页/登录/安全。

---

## 1. 生成效率：四层切分

目标——**LLM 只输出"内容"，不输出样式和脚本**。单页生成体量从 ~30KB 降到 ~2KB。

| 层 | 谁负责 | LLM 输出 |
|----|--------|----------|
| A 框架壳 | 服务端固定组件（顶栏/logo/搜索/页脚/ICP） | 0 |
| B 宏占位符 | LLM 写标记，服务端展开 | 几十字符 |
| C 语义 HTML | LLM 用 `era.css` class 写正文 | 仅正文 |
| D 样式预算 | 可选 `<style>` ≤30 行，仅页面级点睛 | 极少 |

### A 层：壳（每页相同，零 token）
`app/layout.tsx` 固定输出：`<head>` 引 `era.css` + `runtime.js`；`<body data-theme>` 内含顶栏、logo、搜索框、页脚。生成内容只填中间 `<main id="page">`。

### B 层：宏占位符（核心提效手段）
LLM 写极短标记，服务端 `lib/macros.ts` 用正则替换成 `era.css` 结构：
```
[[QUICK_GRID]]                         → 12 格快捷宫格（站点名库内置）
[[HOT_RANK]]                           → 百度热搜榜组件
[[WEATHER:北京]]                       → 天气卡
[[LINKS:常用]] / [[LINKS:视频]]        → 整段分类链接（站点名库内置，28 条）
[[AD:banner|双12全民疯抢节|每满300减50]] → 横幅广告
[[AD:box|传奇霸业|一刀999级]]           → 右栏方块广告
[[AD:popup|领6888装修礼包]]            → 右下角弹窗广告（可关闭）
[[INNER:词条名|显示文字]]              → 协商真实内链
```
> 站点名库与广告文案池放 `lib/blocks.ts`，宏展开时随机/按类填充，保证"像真的"又零生成成本。

### C 层：语义 HTML
LLM 直接用框架 class：`.panel/.links/.fav`、`.layout-news .article`、`.layout-forum .floor` 等（清单见 `era.css`）。**禁止内联 style**（D 层除外）。

### D 层：样式预算
为保留"风格不固定"，允许每页 `<style>` ≤30 行，仅用于页面级强调色/特殊排版；不得覆盖框架核心结构。

### 再叠两招
- **Prompt 缓存**：把"美学约束+时代约束+宏说明"放 prompt **最前且稳定**，DeepSeek 自动 context caching，命中后输入价≈1/10。变动部分（path/query/existingSlugs）放最后。
- **`max_tokens` 封顶**（如 2500）：内容变小后封顶兜底，防失控。

### Token 账（粗估）
| 方案 | 输出 tokens | 相对 |
|------|------------|------|
| 现状（整页含 CSS+JS） | ~9000 | 1× |
| 四层切分后 | ~800–1500 | ~1/6–1/10 |

---

## 2. 成本管理

### 2.1 成本模型（对我们有利）
页面写入 KV 后永久固定 → **全站每条路径只生成一次** →
**总成本 = 历史去重路径数，与浏览量无关**。爆款页被看 N 次，成本仍是 1 次生成。

### 2.2 真正的风险：刷随机路径烧 token
脚本访问 `/a /b /c …` 触发海量生成。对策（全部挂在"登录后"）：
- **per-user 配额**：KV 滑动窗口，如 `quota:<uid>:<yyyymmdd>`，新生成 ≤ 20/天
- **全局熔断**：当日总生成 / 总花费超阈值 → `/api/generate` 暂停生成，只读缓存
- **路径白名单**：`slug` 长度 ≤120、限定字符集、剥控制字符后才入库
- **未登录零成本**：未登录只能读已缓存页面，无法触发生成

### 2.3 计量对账
每次生成写 `generations` 表：
```sql
create table generations (
  id uuid default gen_random_uuid() primary key,
  user_id uuid, slug text,
  input_tokens int, output_tokens int, cost_usd numeric,
  cached boolean default false,
  created_at timestamptz default now()
);
```
据此出日报、定阈值、定位异常用户。

---

## 3. 落地页 / 登录 / 安全

### 3.1 为什么要登录
不是为做用户体系，而是**把"花钱的生成动作"关进认证后**：
```
未登录 → 落地页 + 已缓存页面（纯 KV 读，零成本）
已登录 → 才能触发新路径生成，受 per-user 配额约束
```

### 3.2 🔴 红线一：生成内容必须跑在沙箱 iframe（异源）
LLM 产出的页面**含 `<script>`**。若直接 `dangerouslySetInnerHTML` 注入主站，该脚本可读 Cookie/localStorage、外泄 JWT。
**做法**：
- 认证主站（`app.域名`）只渲染**壳**，不直接执行生成内容
- 生成页放 `<iframe sandbox="allow-scripts" srcdoc="...">`（**绝不加 `allow-same-origin`**），或独立子域 `sandbox.域名` 提供
- iframe 内点内链 → `postMessage` 通知父窗口换 src，父窗口校验后 `router.push`
- 结果：AI 脚本能跑，但碰不到主站登录态

### 3.3 🔴 红线二：用 Supabase Auth，不自研认证
邮箱魔法链接 / OAuth，密码哈希、JWT、会话、CSRF 全托管。
`/api/generate` 服务端**先验 Supabase JWT 再花钱**，未登录直接 401，一个 token 不烧。

### 3.4 🔴 红线三：落地页用静态页，不 LLM 生成
落地页是门面+登录入口，要快/可控/稳定，与"内页幻觉生成"相反。内容：产品说明 + 登录/注册按钮 + 已收录词条计数（读 `kv.keys('page:*')`）。

### 3.5 防护清单
| 风险 | 措施 |
|------|------|
| 刷随机路径烧 token | 登录 + per-user 配额 + 全局熔断 |
| 路径炸 KV / prompt 注入 | slug 长度+字符白名单+剥控制字符 |
| XSS / 偷登录态 | 沙箱 iframe（红线一） |
| 密钥泄露 | DeepSeek key 仅 Edge 服务端，绝不下发 |
| 越权 | Supabase 全表 RLS，按 `auth.uid()` 隔离 |
| 传输/会话 | 全站 HTTPS；Cookie httpOnly+Secure+SameSite |
| 对账 | generations 表计量 + 日报 |

### 3.6 路由调整
```
/                 落地页（静态，未登录可见）
/login /register  Supabase Auth（静态）
/app              已登录主站（壳，渲染沙箱 iframe）
/app/[...path]    内容页（KV-first；未命中且已登录才生成）
/api/generate     Edge，验 JWT → 查配额 → 生成 → 计量 → setIfAbsent
```

---

## 4. 落地实现顺序
1. 抽 `era.css`（✅ 已完成）+ `runtime.js`（待办）
2. 壳 `layout.tsx` 引入静态资产，生成只填 `<main>`
3. `lib/macros.ts` + `lib/blocks.ts`：宏占位符展开 + 站点/广告池
4. 改 prompt：要求"用 class + 宏，不写 CSS/JS"，开 prompt 缓存、设 max_tokens
5. Supabase Auth + 落地页 + `/api/generate` 加 JWT 校验 + 配额 + 计量
6. 沙箱 iframe 渲染生成内容 + postMessage 内链导航
