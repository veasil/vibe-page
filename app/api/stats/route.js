// GET /api/stats — 已封存词条计数（落地页计数器用），公开只读
import { archivedSlugs } from "../../../lib/kv.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const slugs = await archivedSlugs();
  return new Response(JSON.stringify({ count: slugs.length }), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
