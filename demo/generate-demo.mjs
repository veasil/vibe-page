// 验证后端闭环：验权 → 配额 → 生成 → 展开 → 锁定 → 二次秒回 → 配额熔断
// 运行：node demo/generate-demo.mjs
process.env.MOCK_LLM = "1";        // 不接真模型
process.env.GEN_DAILY_QUOTA = "3"; // 配额调小好演示熔断
process.env.GEN_LOG = "1";

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { requireUser } from "../lib/auth.mjs";
import { generatePage, QuotaError } from "../lib/generate.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const line = () => console.log("-".repeat(56));

// 0) 验权（mock）
console.log("【0】鉴权");
try { await requireUser(""); } catch(e){ console.log("  未带 token →", e.name, `(${e.status})`); }
const user = await requireUser("Bearer mock:u123");
console.log("  Bearer mock:u123 →", user.id, user.mock ? "(mock)" : "");
line();

// 1) 首访 /game/lol → 生成
console.log("【1】首访 /game/lol（应：生成 + 扣配额）");
let r = await generatePage({ type:"page", path:"game/lol" }, user);
console.log(`  cached=${r.cached} key=${r.key} 配额=${r.quota.used}/${r.quota.max} 页面=${(r.html.length/1024).toFixed(1)}KB`);
writeFileSync(join(__dir, "generated.html"),
  r.html.replace('href="/era.css"','href="../public/era.css"').replace('src="/runtime.js"','src="../public/runtime.js"'), "utf8");
line();

// 2) 再访同路径 → 秒回缓存，不扣配额（协商真实）
console.log("【2】再访 /game/lol（应：命中缓存，不扣配额）");
r = await generatePage({ type:"page", path:"game/lol" }, user);
console.log(`  cached=${r.cached} key=${r.key}  ← 同一份"真实"，零成本`);
line();

// 3) 连刷不同随机路径 → 触发配额熔断
console.log("【3】刷随机路径（应：配额用尽后被熔断）");
for (const p of ["a","b","c","d","e"]){
  try {
    const x = await generatePage({ type:"page", path:"rand/"+p }, user);
    console.log(`  /rand/${p} → 生成 配额=${x.quota.used}/${x.quota.max}`);
  } catch(e){
    if (e instanceof QuotaError) console.log(`  /rand/${p} → 🛑 ${e.message} (${e.status})`);
    else throw e;
  }
}
line();
console.log("已写出 demo/generated.html（可预览）");
