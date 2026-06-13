// /api/admin — 开发者控制台后端
//   GET  → 快照：provider / authMode / 开关 / 生成统计 / 配额用量 / 已封存词条
//   POST → 设置运行时开关（目前：authForceMock 强制 mock 登录）
// 鉴权：可选 ADMIN_TOKEN（设了就必须带 x-admin-token；没设则 dev 放行）。
import * as kv from "../../../lib/kv.mjs";
import { pickProvider } from "../../../lib/llm.mjs";
import { setAuthForceMock, flagsState } from "../../../lib/flags.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authed(req) {
  const need = process.env.ADMIN_TOKEN;
  if (need) return req.headers.get("x-admin-token") === need;
  // 未配置 ADMIN_TOKEN：仅【非生产】放行（dev 便利）；
  // 生产一律拒绝——否则部署后 /api/admin 裸奔，任何人可删库 / 翻鉴权开关。
  return process.env.NODE_ENV !== "production";
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function GET(req) {
  if (!authed(req)) return json({ error: "admin token 无效" }, 401);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const flags = flagsState();
  const authMode = supabaseUrl && supabaseKey && !flags.effective ? "supabase" : "mock";

  const [slugs, gen, quota, home] = await Promise.all([
    kv.archivedSlugs(),
    kv.readGenStats(),
    kv.quotaUsage(),
    kv.get("home"),
  ]);

  return json({
    env: {
      provider: pickProvider() || "mock",
      authMode,
      supabaseConfigured: !!(supabaseUrl && supabaseKey),
      kvBackend: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL ? "upstash" : "memory",
      quotaDaily: Number(process.env.GEN_DAILY_QUOTA || 20),
      adminTokenRequired: !!process.env.ADMIN_TOKEN,
      homeCached: !!home,
    },
    flags,
    gen,
    quota,
    entries: { count: slugs.length, list: slugs.slice(0, 200) },
  });
}

export async function POST(req) {
  if (!authed(req)) return json({ error: "admin token 无效" }, 401);
  let body;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  if (typeof body.authForceMock === "boolean") {
    const effective = setAuthForceMock(body.authForceMock);
    return json({ ok: true, flags: flagsState(), note: effective === body.authForceMock ? "" : "生产环境已锁定，override 不生效（需 ALLOW_AUTH_OVERRIDE=1）" });
  }
  return json({ error: "无可设置字段" }, 400);
}

// DELETE → 审核下架：删词条 / 清首页缓存（删后该路径可被重新生成新「真实」）
export async function DELETE(req) {
  if (!authed(req)) return json({ error: "admin token 无效" }, 401);
  let body;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  if (body.clearHome) {
    await kv.delRaw("home");
    return json({ ok: true, cleared: "home" });
  }
  if (typeof body.slug === "string" && body.slug.trim()) {
    const removed = await kv.delPage(body.slug.trim());
    return json({ ok: true, deleted: body.slug.trim(), removed: !!removed });
  }
  return json({ error: "需要 slug 或 clearHome:true" }, 400);
}
