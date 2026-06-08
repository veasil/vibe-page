// ============================================================
// kv.mjs — KV 封装（协商真实写入 + 每日配额）
// 生产用 Vercel KV；无凭据时回退内存 Map（重启即清空），保证离线可跑。
// 接生产时把 _mem.* 换成 @vercel/kv 的 get/set/keys/incr 即可。
// ============================================================
// 有 Upstash 凭据 → 用 Upstash Redis；否则回退 globalThis 内存单例（dev 兜底，各路由 bundle 共享）
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const hasKV = !!(REDIS_URL && REDIS_TOKEN);
const _mem = (globalThis.__vibe_mem ||= new Map());

// 懒加载 @upstash/redis，避免无凭据环境下无谓初始化
let _kv = null;
async function vkv(){
  if (_kv) return _kv;
  const { Redis } = await import("@upstash/redis");
  _kv = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });
  return _kv;
}

// ——— 底层：KV 或内存 ———
async function rawGet(k){
  if (hasKV) return (await vkv()).get(k);
  return _mem.has(k) ? _mem.get(k) : null;
}
async function rawSetNX(k, v){
  if (hasKV) return (await (await vkv()).set(k, v, { nx: true })) === "OK";
  if (_mem.has(k)) return false;       // 已存在，不覆盖
  _mem.set(k, v); return true;
}
async function rawKeys(prefix){
  if (hasKV) return (await vkv()).keys(`${prefix}*`);
  return [..._mem.keys()].filter(k => k.startsWith(prefix));
}
async function rawIncr(k, ttlSec){
  if (hasKV){
    const kv = await vkv();
    const n = await kv.incr(k);
    if (n === 1 && ttlSec) await kv.expire(k, ttlSec);  // 首次设过期
    return n;
  }
  const n = (_mem.get(k) || 0) + 1; _mem.set(k, n); return n;
}

// ——— 对外 API ———
export async function get(key){ return rawGet(key); }
export async function keys(prefix = "page:"){ return rawKeys(prefix); }

/** 协商真实：第一次写入即锁定，已存在则返回 false（绝不覆盖 page:*） */
export async function setIfAbsent(key, html){ return rawSetNX(key, html); }

/** 已存档词条 slug 列表（去掉 page: 前缀），注入 prompt 做自引用 */
export async function archivedSlugs(){
  return (await keys("page:")).map(k => k.slice("page:".length));
}

/** 每日新生成配额：返回 {ok, used, max}（调用时读 env，便于测试/动态调整） */
export async function consumeQuota(userId){
  const max = Number(process.env.GEN_DAILY_QUOTA || 20);
  const day = new Date().toISOString().slice(0, 10);     // yyyy-mm-dd
  const used = await rawIncr(`quota:${userId}:${day}`, 2 * 86400); // KV 下 2 天后自动清
  return { ok: used <= max, used, max };
}
