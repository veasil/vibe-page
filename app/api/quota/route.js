// GET /api/quota — 当前用户当日剩余生成额度（额度悬浮窗用）。只读，不消耗。
// 鉴权与 /api/generate 一致：配了 Supabase 走 Cookie 会话，否则回退 mock Bearer。
import { cookies } from "next/headers";
import { createClient, supabaseConfigured } from "@/utils/supabase/server";
import { requireMockUser, AuthError } from "../../../lib/auth.mjs";
import { authForceMock } from "../../../lib/flags.mjs";
import { peekQuota } from "../../../lib/kv.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  let user;
  if (supabaseConfigured() && !authForceMock()) {
    const supabase = createClient(await cookies());
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) return json({ error: "未登录" }, 401);
    user = { id: data.user.id, email: data.user.email };
  } else {
    try { user = requireMockUser(req.headers.get("authorization")); }
    catch (e) { if (e instanceof AuthError) return json({ error: e.message }, 401); throw e; }
  }

  const q = await peekQuota(user.id);
  return json({ ...q, email: user.email || "" }, 200);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "content-type": "application/json; charset=utf-8" },
  });
}
