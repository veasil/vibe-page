// ============================================================
// auth.mjs — 服务端鉴权（Supabase JWT 校验）+ mock 降级
// 红线二：不自研认证。生产用 Supabase 校验 Bearer token；
// 无 Supabase 凭据时进 mock，token 形如 "mock:<uid>" 即放行（仅本地）。
// 红线：/api/generate 必须先过本校验再花钱，未登录直接 401。
// ============================================================
const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL;

export class AuthError extends Error {
  constructor(msg){ super(msg); this.name = "AuthError"; this.status = 401; }
}

/**
 * 校验请求里的 Bearer token，返回 { id, email? }。失败抛 AuthError。
 * @param {string} authHeader  "Bearer xxx"
 */
export async function requireUser(authHeader){
  const token = (authHeader || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new AuthError("未登录");

  if (!hasSupabase){
    // —— 本地 mock：token = "mock:u123" ——
    const m = /^mock:(.+)$/.exec(token);
    if (!m) throw new AuthError("mock 模式 token 需形如 mock:<uid>");
    return { id: m[1], email: `${m[1]}@local`, mock: true };
  }

  // —— 生产：用 Supabase 校验 JWT ——
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/user`, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "apikey": process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    },
  });
  if (!res.ok) throw new AuthError("token 无效或已过期");
  const u = await res.json();
  return { id: u.id, email: u.email };
}
