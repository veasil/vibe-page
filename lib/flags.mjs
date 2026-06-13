// ============================================================
// flags.mjs — 运行时开关（dev 调试用，挂 globalThis 单例跨路由共享）
// 目前只有一个：authForceMock —— 强制走 mock 登录（免验证码自测）。
// 安全红线：该 override 只在非生产环境生效（或显式开 ALLOW_AUTH_OVERRIDE=1），
// 防止部署后被人调用 /api/admin 把线上鉴权降级成 mock。
// ============================================================
const _f = (globalThis.__vibe_flags ||= { authForceMock: false });

// 是否允许 auth override：本地开发默认允许；生产需显式 ALLOW_AUTH_OVERRIDE=1
const OVERRIDE_ALLOWED =
  process.env.NODE_ENV !== "production" || process.env.ALLOW_AUTH_OVERRIDE === "1";

/** 生效的强制 mock 状态（受 OVERRIDE_ALLOWED 闸门约束） */
export function authForceMock() {
  return OVERRIDE_ALLOWED && _f.authForceMock === true;
}

/** 设置开关（返回生效后的状态） */
export function setAuthForceMock(v) {
  _f.authForceMock = !!v;
  return authForceMock();
}

/** 给 admin 展示用的完整状态 */
export function flagsState() {
  return {
    authForceMock: _f.authForceMock === true, // 用户拨到的位置
    effective: authForceMock(),                // 实际生效（生产下可能被闸门压成 false）
    overrideAllowed: OVERRIDE_ALLOWED,
  };
}
