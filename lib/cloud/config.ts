/**
 * 云服务的公开配置（PRISM 应用）
 *
 * 来源：云服务生命周期返回的 publicConfig，可安全出现在前端代码中
 * （publishableKey 只标识应用，不含权限；服务端会校验 Origin 精确匹配）。
 * 环境变量 / 私有 key 一律不放在这里。
 */

export const CLOUD_PUBLIC_CONFIG = {
  endpoint: "https://prism-evidence.app.workbuddy.host",
  publishableKey: "wbpk_w84XpTBoBindWXPE3n1sxe_bP6oDiMiSOXcHmYoALLRcLPWn8kJTtgh",
} as const;

/** 默认模型；模型不可用时由上层降级，不得伪造已推理的状态 */
export const DEFAULT_MODEL_ID = "deepseek-v4.1-flash";
export const FALLBACK_MODEL_ID = "hy3";
