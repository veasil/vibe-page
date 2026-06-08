// 真实链路冒烟：真 DeepSeek 生成 → 真 Upstash 落库 → 二次读缓存
// 运行：node --env-file=.env.local demo/real-smoke.mjs
// 注意：会真实调用一次 DeepSeek（约 $0.001）并写入 Upstash。
import { generatePage } from "../lib/generate.mjs";
import * as kv from "../lib/kv.mjs";

const user = { id: "smoke-" + Date.now() };
const path = "smoke/real-" + Date.now();

console.log("LLM mock?", process.env.MOCK_LLM === "1" || !process.env.DEEPSEEK_API_KEY);
console.log("Upstash?", !!(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL));

console.time("首次生成");
let r = await generatePage({ type: "page", path }, user);
console.timeEnd("首次生成");
console.log(`  cached=${r.cached} 页面=${(r.html.length/1024).toFixed(1)}KB ` +
  `in=${r.usage?.input} out=${r.usage?.output} cost=$${r.costUsd?.toFixed(6)} 配额=${r.quota?.used}/${r.quota?.max}`);
console.log("  含 era.css:", r.html.includes("/era.css"), "| 残留宏:", (r.html.match(/\[\[/g)||[]).length);

console.time("二次读取");
let r2 = await generatePage({ type: "page", path }, user);
console.timeEnd("二次读取");
console.log(`  cached=${r2.cached}  ← 应为 true（从 Upstash 读回）`);

const fromKv = await kv.get("page:" + path);
console.log("Upstash 直读该 key 命中:", !!fromKv, "长度一致:", fromKv?.length === r.html.length);
const all = await kv.archivedSlugs();
console.log("archivedSlugs 含本次:", all.includes(path), "| 当前总数:", all.length);
