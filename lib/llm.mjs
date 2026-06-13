// ============================================================
// llm.mjs — 多 provider LLM 客户端（OpenAI 兼容）+ mock 降级
// 选择顺序：LLM_PROVIDER 显式指定 > 谁有 key 用谁（mimo 优先，快）> mock。
// MOCK_LLM=1 强制 mock，返回紧凑示范输出，离线跑通全链路。
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

// ——— provider 注册表 ———
// price: $/百万 token 约值，仅用于计量展示，不参与计费
const PROVIDERS = {
  mimo: {
    url: "https://api.xiaomimimo.com/v1/chat/completions",
    key: () => process.env.MIMO_API_KEY || process.env.mimo_api_key,
    model: "mimo-v2.5-pro-ultraspeed",
    // ultraspeed 是 reasoning 模型，必须关 thinking，否则 token 全烧在思考上
    extraBody: { thinking: { type: "disabled" } },
    cachedTokens: u => u?.prompt_tokens_details?.cached_tokens ?? 0,
    price: { in: 0.3, inCached: 0.03, out: 1.2 },   // 官网价未公开页面化，粗估
  },
  deepseek: {
    url: "https://api.deepseek.com/v1/chat/completions",
    key: () => process.env.DEEPSEEK_API_KEY,
    model: "deepseek-chat",
    extraBody: {},
    cachedTokens: u => u?.prompt_cache_hit_tokens ?? 0,
    price: { in: 0.27, inCached: 0.07, out: 1.10 },
  },
};

export function pickProvider(){
  if (process.env.MOCK_LLM === "1") return null;
  const want = (process.env.LLM_PROVIDER || "").toLowerCase().trim();
  if (PROVIDERS[want] && PROVIDERS[want].key()) return want;
  for (const name of ["mimo", "deepseek"]) if (PROVIDERS[name].key()) return name;
  return null;   // 无 key → mock
}

// 粗估 token：中文 ~1.5 字/token，英文按 4 字符/token，够计量用
const estTokens = s => Math.ceil([...String(s)].reduce(
  (n, c) => n + (c.charCodeAt(0) > 255 ? 0.7 : 0.25), 0));

function mockOutput(){
  // 用紧凑示范作为"模型产出"（真实接入后由 provider 流式返回）
  return readFileSync(SAMPLE, "utf8");
}

/**
 * 生成。返回 { text, finishReason, usage:{input,output,cached,provider} }。
 * @param {{role:string,content:string}[]} messages
 * @param {object} params  见 prompt.GEN_PARAMS（model 可覆盖 provider 默认）
 */
export async function generate(messages, params = {}){
  const input = messages.reduce((n, m) => n + estTokens(m.content), 0);
  const name = pickProvider();

  if (!name){
    await new Promise(r => setTimeout(r, 80));   // 模拟网络
    const text = mockOutput();
    return { text, finishReason: "stop", usage: { input, output: estTokens(text), cached: 0, mock: true } };
  }

  const p = PROVIDERS[name];
  const res = await fetch(p.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${p.key()}`,
    },
    body: JSON.stringify({
      model: params.model || p.model,
      temperature: params.temperature ?? 0.9,
      max_tokens: params.max_tokens ?? 4000,
      stream: false,           // 生产建议 stream:true 边收边渲染；此处取整段便于落库
      messages,
      ...p.extraBody,
    }),
  });
  if (!res.ok) throw new Error(`${name} ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const u = data.usage || {};
  return {
    text: data.choices?.[0]?.message?.content || "",
    // finish_reason='length' 表示撞到 max_tokens 被截断，页面不完整（调用方据此拒绝写入）
    finishReason: data.choices?.[0]?.finish_reason || "stop",
    usage: {
      provider: name,
      input: u.prompt_tokens ?? input,
      output: u.completion_tokens ?? 0,
      cached: p.cachedTokens(u),
    },
  };
}

export function estCostUsd(usage){
  const price = PROVIDERS[usage?.provider]?.price || PROVIDERS.deepseek.price;
  const cached = usage.cached || 0;
  const freshIn = Math.max(0, (usage.input || 0) - cached);
  return (freshIn * price.in + cached * price.inCached + (usage.output || 0) * price.out) / 1e6;
}
