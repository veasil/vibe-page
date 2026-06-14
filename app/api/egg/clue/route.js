// GET /api/egg/clue — 公开线索（落地页用）。只吐期号/线索/发现数，绝不含谜底。
import { publicClue } from "../../../../lib/egg.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const data = await publicClue();
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
