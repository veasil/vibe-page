// GET /api/archive — 已封存词条列表（收录词条页用），公开只读
// 只返回 slug 文本，不返回页面 HTML；上限 1000 条，避免 KV keys 过大撑爆响应。
import { archivedSlugs } from "../../../lib/kv.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const all = await archivedSlugs();
  const slugs = all.slice().sort().slice(0, 1000);
  return new Response(JSON.stringify({ count: all.length, slugs }), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
