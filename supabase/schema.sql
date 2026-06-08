-- Supabase 初始化：在 SQL Editor 执行。认证表由 Supabase Auth 自带，这里只建业务表。

-- 生成计量（成本对账 / 异常用户定位 / 全局熔断依据）
create table if not exists generations (
  id uuid default gen_random_uuid() primary key,
  user_id uuid,
  slug text,
  input_tokens int,
  output_tokens int,
  cost_usd numeric,
  cached boolean default false,
  created_at timestamptz default now()
);
alter table generations enable row level security;
-- 由已登录用户自己的会话写入计量行（API 路由用其 Supabase 客户端 insert）
create policy "insert own generations" on generations
  for insert with check (auth.uid() = user_id);
-- 用户可查看自己的用量
create policy "select own generations" on generations
  for select using (auth.uid() = user_id);

-- 用户反馈（"太假/太真/内容问题"）
create table if not exists feedback (
  id uuid default gen_random_uuid() primary key,
  page_url text not null,
  slug text,
  type text check (type in ('too_obvious','too_real','content_issue','other')),
  comment text,
  user_id uuid default auth.uid(),
  created_at timestamptz default now()
);
alter table feedback enable row level security;
create policy "anyone insert feedback" on feedback for insert with check (true);
create policy "own feedback read" on feedback for select using (auth.uid() = user_id);
