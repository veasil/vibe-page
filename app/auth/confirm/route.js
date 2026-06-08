// GET /auth/confirm — 统一处理所有 Supabase 邮件登录回调
// 支持：?token_hash=（OTP直验）和 ?code=（PKCE交换）两种模式
// 验证成功后生成 relay 码写入 KV（5分钟），跳转到 bridge 页面完成跨浏览器移交
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient, supabaseConfigured } from "@/utils/supabase/server";
import { setRelay } from "../../../lib/kv.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function relayCode() {
  // 10 位大写字母数字，人类可读可抄写
  return crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
}

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const code       = searchParams.get("code");        // PKCE 模式
  const type       = searchParams.get("type") || "email";
  const next       = searchParams.get("next") || "/app.html";

  if (!supabaseConfigured()) {
    return NextResponse.redirect(`${origin}/login.html?err=supabase_not_configured`);
  }

  const supabase = createClient(await cookies());
  let session = null, authError = null;

  if (token_hash) {
    // 模式 A：OTP token_hash（Supabase 推荐，signInWithOtp 默认）
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash });
    session = data?.session; authError = error;
  } else if (code) {
    // 模式 B：PKCE code 交换（部分 Supabase 项目配置下走此路）
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    session = data?.session; authError = error;
  } else {
    // 既无 token_hash 也无 code：可能是 hash fragment 隐式流，需要客户端 JS 处理
    const nextEnc = encodeURIComponent(next);
    return NextResponse.redirect(`${origin}/auth/bridge.html?next=${nextEnc}&mode=implicit`);
  }

  if (authError || !session) {
    const msg = encodeURIComponent(authError?.message || "auth_failed");
    return NextResponse.redirect(`${origin}/login.html?err=${msg}`);
  }

  // ✅ 验证成功 → 生成 relay 码，存入 KV（5 min），跳到 bridge
  const rc = relayCode();
  await setRelay(rc, {
    access_token:  session.access_token,
    refresh_token: session.refresh_token,
    next,
  });

  return NextResponse.redirect(`${origin}/auth/bridge.html?code=${rc}`);
}
