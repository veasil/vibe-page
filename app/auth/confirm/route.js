// GET /auth/confirm?token_hash=...&type=email&next=/app.html
// Supabase 官方 SSR 推荐的邮件登录确认流程（verifyOtp + token_hash）。
// 比 PKCE ?code 更稳：客户端无需 code_verifier cookie，不易因上下文丢失而失败。
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient, supabaseConfigured } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") || "email";
  const next = searchParams.get("next") || "/app.html";

  if (token_hash && supabaseConfigured()) {
    const supabase = createClient(await cookies());
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      return NextResponse.redirect(`${origin}${next.startsWith("/") ? next : "/" + next}`);
    }
    return NextResponse.redirect(`${origin}/login.html?err=${encodeURIComponent(error.message)}`);
  }
  return NextResponse.redirect(`${origin}/login.html?err=auth`);
}
