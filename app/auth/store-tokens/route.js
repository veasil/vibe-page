// POST /auth/store-tokens — 接收隐式流 hash token，存成 relay 码
// 供 bridge.html 在客户端取到 access_token/refresh_token 后调用
import { setRelay } from "../../../lib/kv.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const { access_token, refresh_token, next } = body;
  if (!access_token || !refresh_token) return json({ error: "missing tokens" }, 400);

  const code = crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
  await setRelay(code, { access_token, refresh_token, next: next || "/app.html" });
  return json({ code });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "content-type": "application/json" },
  });
}
