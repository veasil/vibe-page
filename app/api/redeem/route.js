// POST /api/redeem  { code }  — 邀请码 / 兑换码核销入口。
//   邀请码(INV-…) → 账号升级为无限额度；兑换码(RDM-…) → +N 次 bonus 额度。
//   均单次失效，原子核销逻辑见 lib/codes.mjs。
import { cookies } from "next/headers";
import { createClient, supabaseConfigured } from "@/utils/supabase/server";
import { requireMockUser, AuthError } from "../../../lib/auth.mjs";
import { authForceMock } from "../../../lib/flags.mjs";
import { redeemCode } from "../../../lib/codes.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  // 鉴权（要知道给谁加额度）
  let user;
  if (supabaseConfigured() && !authForceMock()) {
    const supabase = createClient(await cookies());
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) return json({ ok: false, error: "未登录" }, 401);
    user = { id: data.user.id };
  } else {
    try { user = requireMockUser(req.headers.get("authorization")); }
    catch (e) { if (e instanceof AuthError) return json({ ok: false, error: e.message }, 401); throw e; }
  }

  let body;
  try { body = await req.json(); } catch { return json({ ok: false, message: "请求体非 JSON" }, 400); }
  const code = String(body.code || "").trim().slice(0, 32);
  if (!code) return json({ ok: false, message: "请输入兑换码" }, 200);

  const result = await redeemCode(user.id, code);
  return json(result, 200);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "content-type": "application/json; charset=utf-8" },
  });
}
