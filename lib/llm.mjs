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
    // 真实价（官网公示，$/百万 token，按 ¥7.2/$ 折算）：
    // UltraSpeed = MiMo-V2.5-Pro 基础价 ×3 的限时体验价（2026/6/9–6/23）。
    // 基础价 ¥3/¥0.025/¥6（入/缓存/出）→ UltraSpeed ¥9/¥0.075/¥18 → 折 USD：
    price: { in: 1.25, inCached: 0.0104, out: 2.5 },
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

// 上游 LLM 调用失败的结构化错误：区分「网络连不上(代理/VPN)」与「provider 返回非 2xx(欠费/key失效/限流)」。
// 调用方据 kind 映射响应：billing/network/rate → 可重试或换网；auth/upstream → 服务端配置/上游故障。
export class UpstreamError extends Error {
  constructor({ kind, provider, upstreamStatus, detail }){
    const label = {
      network: "无法连接到生成服务（疑似网络 / 代理问题）",
      billing: "生成服务额度不足（账户欠费）",
      auth: "生成服务认证失败（API key 失效或无权限）",
      rate: "生成服务繁忙（上游限流），请稍后重试",
      upstream: "生成服务异常",
    }[kind] || "生成服务异常";
    super(upstreamStatus ? `${label}（${provider} HTTP ${upstreamStatus}）` : `${label}（${provider}）`);
    this.name = "UpstreamError";
    this.kind = kind;
    this.provider = provider;
    this.upstreamStatus = upstreamStatus || null;
    this.detail = detail || "";       // 上游响应体片段，仅用于服务端日志，不回传前端
    // 网络/欠费/限流可换网或稍后重试 → 503；认证/其它上游故障是服务端侧 → 502
    this.status = (kind === "auth" || kind === "upstream") ? 502 : 503;
    this.retryable = kind === "network" || kind === "rate";
  }
}

// 把上游 HTTP 状态码归类
function classifyStatus(s){
  if (s === 402) return "billing";
  if (s === 401 || s === 403) return "auth";
  if (s === 429) return "rate";
  // 部分 provider 用 400 + 错误体表达余额不足，交给 detail 关键词兜底（见 generate 调用处）
  return "upstream";
}

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
  let res;
  try {
    res = await fetch(p.url, {
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
  } catch (e) {
    // fetch 直接抛错 = 连接都没建立：DNS/TLS/连接被拒/超时 → 几乎都是网络或代理问题
    throw new UpstreamError({ kind: "network", provider: name, detail: String(e?.message || e) });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let kind = classifyStatus(res.status);
    // 有的 provider 用 400 + "insufficient balance/欠费/余额" 表达欠费，关键词兜底归到 billing
    if (kind === "upstream" && /insufficient|balance|欠费|余额|quota|额度/i.test(body)) kind = "billing";
    throw new UpstreamError({ kind, provider: name, upstreamStatus: res.status, detail: body.slice(0, 500) });
  }
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
