// ============================================================
// codes.mjs — 邀请码 / 兑换码：生成、核销、列表、作废、删除
//   invite  → 核销后把账号标记为「无限额度」(unlimited)，绕过每日配额
//   redeem  → 核销后给账号 +N 次 bonus 额度（默认 20），用完即止
//   两者皆【单次失效】：靠 KV 原子自增 claim 计数器，第一个把计数器
//   incr 到 1 的请求获胜，其余一律「已被使用」。
// 存储：
//   code:<CODE>      -> { type, bonus, note, status, createdAt, redeemedBy?, redeemedAt? }
//   codeuse:<CODE>   -> 核销计数器（incr 原子单次锁；与 code:* 列表前缀互不命中）
// ============================================================
import { webcrypto } from "node:crypto";
import * as kv from "./kv.mjs";

const PREFIX = "code:";
const CLAIM_PREFIX = "codeuse:";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去掉易混 0/O/1/I/L
const DEFAULT_BONUS = 20;

function randCode(len = 8){
  const buf = new Uint8Array(len);
  webcrypto.getRandomValues(buf);
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHABET[buf[i] % ALPHABET.length];
  return s;
}

function normalize(raw){ return String(raw || "").trim().toUpperCase().slice(0, 32); }

/** 批量生成码。redeem 默认面值 20；invite 面值忽略（=无限额度）。 */
export async function generateCodes({ type, count = 1, bonus, note = "" } = {}){
  if (type !== "invite" && type !== "redeem") throw new Error("type 必须为 invite 或 redeem");
  count = Math.max(1, Math.min(200, count | 0));
  const b = type === "redeem" ? (bonus > 0 ? (bonus | 0) : DEFAULT_BONUS) : 0;
  const prefix = type === "invite" ? "INV-" : "RDM-";
  const safeNote = String(note || "").slice(0, 80);
  const created = [];
  for (let i = 0; i < count; i++){
    let code, ok = false, tries = 0;
    while (!ok && tries++ < 6){
      code = prefix + randCode(8);
      const rec = { type, bonus: b, note: safeNote, status: "active", createdAt: Date.now() };
      ok = await kv.setIfAbsent(PREFIX + code, rec);   // NX：撞码自动重试
    }
    if (ok) created.push(code);
  }
  return { ok: true, type, bonus: b, codes: created };
}

/** 核销一个码（给 userId）。原子单次：claim 计数器到 1 才生效。 */
export async function redeemCode(userId, raw){
  const code = normalize(raw);
  if (!code) return { ok: false, message: "请输入兑换码" };
  const rec = await kv.get(PREFIX + code);
  if (!rec || typeof rec !== "object") return { ok: false, message: "兑换码无效或不存在" };
  if (rec.status === "revoked") return { ok: false, message: "该兑换码已作废" };

  // 原子单次核销：第一个把计数器自增到 1 的请求获胜
  const claim = await kv.incr(CLAIM_PREFIX + code);
  if (claim !== 1) return { ok: false, message: "该兑换码已被使用" };

  // 落地效果
  if (rec.type === "invite") await kv.setUnlimited(userId);
  else                       await kv.addBonus(userId, rec.bonus || DEFAULT_BONUS);

  // 标记记录（信息性，best-effort）
  rec.status = "used"; rec.redeemedBy = userId; rec.redeemedAt = Date.now();
  await kv.put(PREFIX + code, rec).catch(() => {});

  return rec.type === "invite"
    ? { ok: true, type: "invite", message: "邀请码已激活：你的账号已升级为无限生成额度 🎉" }
    : { ok: true, type: "redeem", bonus: rec.bonus || DEFAULT_BONUS,
        message: `兑换成功，已为你增加 ${rec.bonus || DEFAULT_BONUS} 次生成额度` };
}

/** 列出所有码（admin 控制台用），含核销状态。按创建时间倒序。 */
export async function listCodes(limit = 500){
  const ks = await kv.keys(PREFIX);   // code:*（不会命中 codeuse:*）
  const rows = [];
  for (const k of ks){
    const code = k.slice(PREFIX.length);
    const rec = await kv.get(k);
    if (!rec || typeof rec !== "object") continue;
    const claim = +(await kv.get(CLAIM_PREFIX + code)) || 0;
    rows.push({
      code, type: rec.type, bonus: rec.bonus || 0, note: rec.note || "",
      status: rec.status === "revoked" ? "revoked" : (claim >= 1 ? "used" : "active"),
      createdAt: rec.createdAt || 0,
      redeemedBy: rec.redeemedBy || "", redeemedAt: rec.redeemedAt || 0,
    });
    if (rows.length >= limit) break;
  }
  rows.sort((a, b) => b.createdAt - a.createdAt);
  return rows;
}

/** 作废一个未使用的码（之后核销一律拒绝） */
export async function revokeCode(raw){
  const code = normalize(raw);
  const rec = await kv.get(PREFIX + code);
  if (!rec || typeof rec !== "object") return { ok: false, message: "未找到该码" };
  rec.status = "revoked";
  await kv.put(PREFIX + code, rec);
  return { ok: true };
}

/** 彻底删除一个码记录（含核销计数器） */
export async function deleteCode(raw){
  const code = normalize(raw);
  await kv.delRaw(PREFIX + code);
  await kv.delRaw(CLAIM_PREFIX + code);
  return { ok: true };
}
