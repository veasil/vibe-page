// 演示：紧凑 LLM 输出 → 宏展开 → 壳包裹 → 完整页面
// 运行：node demo/build.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { expandMacros } from "../lib/macros.mjs";
import { renderShell } from "../lib/shell.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));

// 1) 读取「LLM 产出」（紧凑，含 class + 宏占位符）
const llm = readFileSync(join(__dir, "sample-llm-output.html"), "utf8");

// 2) 服务端展开宏
const main = expandMacros(llm);

// 3) 壳包裹（A 层，零 token）；demo 用相对路径引用静态资产
const html = renderShell({
  title: "hao123_上网从这里开始",
  theme: "baidu",
  main,
  cssHref: "../public/era.css",
  jsHref: "../public/runtime.js",
});

writeFileSync(join(__dir, "index.html"), html, "utf8");

// 4) 体量对比
const b = s => Buffer.byteLength(s, "utf8");
const kb = n => (n / 1024).toFixed(1) + "KB";
console.log("== 生成流水线体量对比 ==");
console.log("LLM 实际输出(紧凑+宏) :", kb(b(llm)), `(${b(llm)} 字节)`);
console.log("宏展开后正文          :", kb(b(main)));
console.log("壳包裹后完整页面      :", kb(b(html)));
console.log("旧方案(整页含CSS+JS)  : 约 30.0KB  ← 此前 hao123.html");
console.log(`\n→ LLM 需产出的体量约为旧方案的 1/${(30720 / b(llm)).toFixed(0)}`);
console.log("已写出 demo/index.html");
