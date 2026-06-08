// ============================================================
// llm.mjs — DeepSeek 客户端（OpenAI 兼容）+ mock 降级
// MOCK_LLM=1 或无 DEEPSEEK_API_KEY 时，返回紧凑示范输出，离线跑通全链路。
// ============================================================
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const _sampleCands = [
  join(process.cwd(), "demo", "sample-llm-output.html"),
  join(__dir, "..", "demo", "sample-llm-output.html"),
];
const SAMPLE = _sampleCands.find(existsSync) || _sampleCands[0];

// 粗估 token：中文 ~1.5 字/token，英文按 4 字符/token，够计量用
const estTokens = s => Math.ceil([...String(s)].reduce(
  (n, c) => n + (c.charCodeAt(0) > 255 ? 0.7 : 0.25), 0));

function mockOutput(){
  // 用紧凑示范作为"模型产出"（真实接入后由 DeepSeek 流式返回）
  return readFileSync(SAMPLE, "utf8");
}
const isMock = () => process.env.MOCK_LLM === "1" || !process.env.DEEPSEEK_API_KEY;

/**
 * 生成。返回 { text, usage:{input,output,cached} }。
 * @param {{role:string,content:string}[]} messages
 * @param {object} params  见 prompt.GEN_PARAMS
 */
export async function generate(messages, params = {}){
  const input = messages.reduce((n, m) => n + estTokens(m.content), 0);

  if (isMock()){
    await new Promise(r => setTimeout(r, 80));   // 模拟网络
    const text = mockOutput();
    return { text, usage: { input, output: estTokens(text), cached: false, mock: true } };
  }

  const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: params.model || "deepseek-chat",
      temperature: params.temperature ?? 0.9,
      max_tokens: params.max_tokens ?? 2500,
      stream: false,           // 生产建议 stream:true 边收边渲染；此处取整段便于落库
      messages,
    }),
  });
  if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const u = data.usage || {};
  return {
    text: data.choices?.[0]?.message?.content || "",
    usage: {
      input: u.prompt_tokens ?? input,
      output: u.completion_tokens ?? 0,
      // DeepSeek 返回命中缓存的 token 数，用于成本核算
      cached: u.prompt_cache_hit_tokens ?? 0,
    },
  };
}

// DeepSeek 报价（$/百万 token，约值，用于计量）
const PRICE = { in: 0.27, inCached: 0.07, out: 1.10 };
export function estCostUsd(usage){
  const cached = usage.cached || 0;
  const freshIn = Math.max(0, (usage.input || 0) - cached);
  return (freshIn * PRICE.in + cached * PRICE.inCached + (usage.output || 0) * PRICE.out) / 1e6;
}
