// GET /auth/relay?code=XXXXXXXX — 用 relay 码换取会话 Cookie
// 在目标浏览器（Edge）里打开，读取 KV 里暂存的 session，写入 Cookie，跳转目标页
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient, supabaseConfigured } from "@/utils/supabase/server";
import { takeRelay } from "../../../lib/kv.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) return NextResponse.redirect(`${origin}/login.html?err=missing_code`);
  if (!supabaseConfigured()) return NextResponse.redirect(`${origin}/login.html?err=no_supabase`);

  const relay = await takeRelay(code);   // 一次性读取并删除
  if (!relay) {
    // 码不存在或已过期（5 分钟）
    return NextResponse.redirect(`${origin}/login.html?err=relay_expired`);
  }

  const supabase = createClient(await cookies());
  const { error } = await supabase.auth.setSession({
    access_token:  relay.access_token,
    refresh_token: relay.refresh_token,
  });

  if (error) {
    return NextResponse.redirect(`${origin}/login.html?err=${encodeURIComponent(error.message)}`);
  }

  // ✅ 会话写入此浏览器的 Cookie，跳转目标页
  const next = relay.next || "/app.html";
  return NextResponse.redirect(`${origin}${next.startsWith("/") ? next : "/" + next}`);
}
