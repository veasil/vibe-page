// GET /api/config — 下发"公开"客户端配置（landing/login/app 用）
// publishable key 设计上可公开（受 RLS 保护）；service role 绝不下发。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  return new Response(JSON.stringify({
    supabaseUrl,
    supabaseKey,
    authMode: supabaseUrl && supabaseKey ? "supabase" : "mock",
  }), { headers: { "content-type": "application/json; charset=utf-8" } });
}
