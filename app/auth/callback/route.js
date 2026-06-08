// GET /auth/callback?code=...&next=/app.html — 魔法链接回跳，换取会话并写 Cookie
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient, supabaseConfigured } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") || "/app.html";

  if (code && supabaseConfigured()) {
    const supabase = createClient(await cookies());
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next.startsWith("/") ? next : "/" + next}`);
  }
  return NextResponse.redirect(`${origin}/login.html?err=auth`);
}
