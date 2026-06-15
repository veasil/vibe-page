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
async function rawDecr(k){
  if (hasKV) return (await vkv()).decr(k);
  const n = Math.max(0, (_mem.get(k) || 0) - 1); _mem.set(k, n); return n;
}
async function rawIncrBy(k, n){
  if (hasKV) return (await vkv()).incrby(k, n);
  const v = (_mem.get(k) || 0) + n; _mem.set(k, v); return v;
}
async function rawDel(k){
  if (hasKV) return (await vkv()).del(k);
  return _mem.delete(k) ? 1 : 0;
}
async function rawSet(k, v){
  if (hasKV) return (await vkv()).set(k, v);   // Upstash 存对象自动 JSON 序列化/反序列化
  _mem.set(k, v); return "OK";
}

// ——— 对外 API ———
/** 可覆盖写（区别于 setIfAbsent 的 NX）；存对象亦可 */
export async function put(key, val){ return rawSet(key, val); }
/** 自增计数（彩蛋发现数等） */
export async function incr(key){ return rawIncr(key); }
export async function get(key){ return rawGet(key); }
export async function keys(prefix = "page:"){ return rawKeys(prefix); }

/** 协商真实：第一次写入即锁定，已存在则返回 false（绝不覆盖 page:*） */
export async function setIfAbsent(key, html){ return rawSetNX(key, html); }

/** 已存档词条 slug 列表（去掉 page: 前缀），注入 prompt 做自引用 */
export async function archivedSlugs(){
  return (await keys("page:")).map(k => k.slice("page:".length));
}

/** 删除一个已封存词条（admin 审核/下架用；删后该路径可被重新生成新「真实」）
 *  slug 恒被 page: 前缀，无法越权删到 stat:/quota:/home 等其它命名空间。 */
export async function delPage(slug){
  const clean = String(slug || "").split("").filter(function(c){
    var n = c.charCodeAt(0); return n >= 32 && n !== 127 && c !== "<" && c !== ">";
  }).join("").slice(0, 120);
  return clean ? rawDel("page:" + clean) : 0;
}
/** 删除任意 key（如 home 缓存，让首页重新生成） */
export async function delRaw(key){ return rawDel(key); }

/** 每日新生成配额：返回 {ok, source, used, max}（调用时读 env，便于测试/动态调整）
 *  扣减顺序：unlimited 用户直接放行 → 当日免费额度 → bonus 余额（兑换码充值）。
 *  source 标记本次扣在哪个桶，供 refundQuota 精确回滚。 */
export async function consumeQuota(userId){
  if (await isUnlimited(userId)) return { ok: true, unlimited: true, source: "unlimited", used: 0, max: -1 };
  const max = Number(process.env.GEN_DAILY_QUOTA || 20);
  const day = new Date().toISOString().slice(0, 10);     // yyyy-mm-dd
  const used = await rawIncr(`quota:${userId}:${day}`, 2 * 86400); // KV 下 2 天后自动清
  if (used <= max) return { ok: true, source: "daily", used, max };
  // 当日免费额度已用尽 → 回滚这次自增（把当日计数钉在 max），改动用 bonus 余额
  await rawDecr(`quota:${userId}:${day}`);
  const bonus = +(await rawGet(`quota:bonus:${userId}`)) || 0;
  if (bonus > 0){
    await rawDecr(`quota:bonus:${userId}`);
    return { ok: true, source: "bonus", used: max, max, bonus: bonus - 1 };
  }
  return { ok: false, source: "none", used: max, max, bonus: 0 };
}

/** 只读查看额度（不消耗）：额度悬浮窗用。
 *  返回 {unlimited, used, max, dailyRemaining, bonus, remaining, day}。 */
export async function peekQuota(userId){
  const max = Number(process.env.GEN_DAILY_QUOTA || 20);
  const day = new Date().toISOString().slice(0, 10);
  if (await isUnlimited(userId))
    return { unlimited: true, used: 0, max, dailyRemaining: -1, bonus: 0, remaining: -1, day };
  const used = +(await rawGet(`quota:${userId}:${day}`)) || 0;
  const bonus = +(await rawGet(`quota:bonus:${userId}`)) || 0;
  const dailyRemaining = Math.max(0, max - used);
  return { unlimited: false, used, max, dailyRemaining, bonus, remaining: dailyRemaining + bonus, day };
}

/** 退还一次配额：生成失败（如截断）时回滚，避免白扣用户额度。
 *  按 consumeQuota 返回的 source 精确回滚（daily / bonus / unlimited 不回滚）。 */
export async function refundQuota(userId, source = "daily"){
  if (source === "unlimited" || source === "none") return;
  if (source === "bonus"){ await rawIncrBy(`quota:bonus:${userId}`, 1); return; }
  const day = new Date().toISOString().slice(0, 10);
  await rawDecr(`quota:${userId}:${day}`);
}

// ——— bonus 余额（兑换码充值） & unlimited 标记（邀请码激活） ———
/** 给用户增加 N 次 bonus 额度（兑换码核销时调用），返回新余额 */
export async function addBonus(userId, n){ return rawIncrBy(`quota:bonus:${userId}`, Math.max(0, n | 0)); }
/** 读 bonus 余额 */
export async function getBonus(userId){ return +(await rawGet(`quota:bonus:${userId}`)) || 0; }
/** 标记用户为无限额度（邀请码核销时调用） */
export async function setUnlimited(userId){ return rawSet(`user:unlimited:${userId}`, 1); }
/** 用户是否无限额度 */
export async function isUnlimited(userId){ return !!(await rawGet(`user:unlimited:${userId}`)); }

// ——— admin 统计（轻量 KV 计数器，mock 内存 / Upstash 通用，不依赖 Supabase service role）———

/** 记一次真实生成的用量（cost 以 micro-USD 存为整数便于 incr） */
export async function bumpGenStats({ inTok = 0, outTok = 0, costMicro = 0 } = {}){
  await rawIncr("stat:gen:count");
  if (inTok)    await rawIncrBy("stat:tok:in", inTok);
  if (outTok)   await rawIncrBy("stat:tok:out", outTok);
  if (costMicro)await rawIncrBy("stat:cost:micro", costMicro);
  const day = new Date().toISOString().slice(0, 10);
  await rawIncr(`stat:gen:${day}`);
}

/** 读聚合生成统计 */
export async function readGenStats(){
  const [count, tin, tout, cost] = await Promise.all([
    rawGet("stat:gen:count"), rawGet("stat:tok:in"),
    rawGet("stat:tok:out"), rawGet("stat:cost:micro"),
  ]);
  const day = new Date().toISOString().slice(0, 10);
  const today = await rawGet(`stat:gen:${day}`);
  return {
    count: +count || 0, today: +today || 0,
    tokIn: +tin || 0, tokOut: +tout || 0, costUsd: (+cost || 0) / 1e6,
  };
}

/** 各用户【当日】配额用量。
 *  只返回今天的 quota:<uid>:<day> 行——历史日期的计数（内存模式不过期、KV 模式 2 天才过期）
 *  不该出现在“当日”视图里；同时排除 quota:bonus:<uid>（那是兑换余额，不是当日用量）。 */
export async function quotaUsage(){
  const today = new Date().toISOString().slice(0, 10);
  const ks = await rawKeys("quota:");
  const rows = [];
  for (const k of ks){
    const parts = k.slice("quota:".length).split(":");   // quota:<uid>:<day>
    const day = parts.pop();
    if (parts[0] === "bonus") continue;                   // quota:bonus:<uid> 非当日用量
    if (day !== today) continue;                          // 只看今天
    rows.push({ user: parts.join(":"), day, used: +(await rawGet(k)) || 0 });
  }
  return rows.sort((a, b) => b.used - a.used);
}
