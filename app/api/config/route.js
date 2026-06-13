// GET /api/config — 下发"公开"客户端配置（landing/login/app 用）
// publishable key 设计上可公开（受 RLS 保护）；service role 绝不下发。
import { authForceMock } from "../../../lib/flags.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  // admin 开关：强制 mock 登录时即便配了 Supabase 也对外报 mock
  const forceMock = authForceMock();
  return new Response(JSON.stringify({
    supabaseUrl,
    supabaseKey,
    authMode: supabaseUrl && supabaseKey && !forceMock ? "supabase" : "mock",
  }), { headers: { "content-type": "application/json; charset=utf-8" } });
}
