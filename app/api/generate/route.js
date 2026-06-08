// POST /api/generate — 验权 → 配额 → 生成/缓存 → 返回 HTML
// 鉴权：配了 Supabase 走 Cookie 会话（@supabase/ssr）；否则回退 mock Bearer。
import { cookies } from "next/headers";
import { createClient, supabaseConfigured } from "@/utils/supabase/server";
import { requireUser, AuthError } from "../../../lib/auth.mjs";
import { generatePage, QuotaError } from "../../../lib/generate.mjs";
import { sanitizeSlug } from "../../../lib/prompt.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 真实 DeepSeek 生成约 30s；Vercel 默认 10s 会超时。Hobby 最高 60s，Pro 最高 300s。
export const maxDuration = 60;

export async function POST(req) {
  // 1) 鉴权（未登录 401，不花一分钱）
  let user, supabase = null;
  if (supabaseConfigured()) {
    supabase = createClient(await cookies());
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) return json({ error: "未登录" }, 401);
    user = { id: data.user.id, email: data.user.email };
  } else {
    try { user = await requireUser(req.headers.get("authorization")); }
    catch (e) { if (e instanceof AuthError) return json({ error: e.message }, 401); throw e; }
  }

  // 2) 解析 + 清洗入参
  let body;
  try { body = await req.json(); } catch { return json({ error: "请求体非 JSON" }, 400); }
  const type = ["home", "page", "search"].includes(body.type) ? body.type : "page";
  const task = {
    type,
    path: type === "page" ? sanitizeSlug(body.path) : undefined,
    query: type === "search" ? sanitizeSlug(body.query) : undefined,
  };
  if (type === "page" && !task.path) return json({ error: "缺少 path" }, 400);

  // 3) 生成（命中缓存零成本；否则扣配额后生成）
  try {
    const r = await generatePage(task, user);

    // 4) 计量落库（真实 Supabase + 非缓存时；用用户会话客户端，受 RLS 保护）
    if (supabase && !r.cached && r.usage) {
      supabase.from("generations").insert({
        user_id: user.id, slug: r.key,
        input_tokens: r.usage.input, output_tokens: r.usage.output,
        cost_usd: r.costUsd, cached: !!r.usage.cached,
      }).then(({ error }) => { if (error) console.error("[meter:supabase]", error.message); });
    }

    return new Response(r.html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "x-cache": r.cached ? "HIT" : "MISS",
        "x-quota": r.quota ? `${r.quota.used}/${r.quota.max}` : "",
      },
    });
  } catch (e) {
    if (e instanceof QuotaError) return json({ error: e.message, quota: e.quota }, 429);
    console.error("[generate]", e);
    return json({ error: "生成失败" }, 500);
  }
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "content-type": "application/json; charset=utf-8" },
  });
}
