// POST /auth/set-session
// OTP 验证码流程的最后一步：
// 客户端 verifyOtp 成功后，把 access_token/refresh_token POST 过来，
// 服务端用 @supabase/ssr 写入 httpOnly Cookie，之后 /api/generate 就能认证。
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient, supabaseConfigured } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return err("bad_json"); }

  const { access_token, refresh_token } = body;
  if (!access_token || !refresh_token) return err("missing_tokens");
  if (!supabaseConfigured()) return err("supabase_not_configured");

  const supabase = createClient(await cookies());
  const { error } = await supabase.auth.setSession({ access_token, refresh_token });
  if (error) return err(error.message);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function err(msg) {
  return new Response(JSON.stringify({ error: msg }), {
    status: 400,
    headers: { "content-type": "application/json" },
  });
}
