/**
 * PRISM 共享类型定义
 * 依据 PRISM-HO-001 §12 数据模型
 * 所有页面、组件、API 必须复用本文件，禁止另建同名但不同义的类型。
 */

/* ---------------- §8.1 证据关系（固定分类） ---------------- */

export const EVIDENCE_RELATIONS = [
  "supports",
  "contradicts",
  "context",
  "unverified",
] as const;

export type EvidenceRelation = (typeof EVIDENCE_RELATIONS)[number];

export const RELATION_LABEL: Record<EvidenceRelation, { zh: string; en: string }> =
  {
    supports: { zh: "支持", en: "SUPPORTS" },
    contradicts: { zh: "反对", en: "CONTRADICTS" },
    context: { zh: "背景", en: "CONTEXT" },
    unverified: { zh: "待核验", en: "UNVERIFIED" },
  };

/* ---------------- §8.2 结论状态 ---------------- */

export const RESULT_STATUSES = [
  "supported",
  "partially_supported",
  "conflicting",
  "insufficient_evidence",
] as const;

export type ResultStatus = (typeof RESULT_STATUSES)[number];

export const RESULT_STATUS_LABEL: Record<
  ResultStatus,
  { zh: string; en: string; note: string }
> = {
  supported: {
    zh: "证据支持",
    en: "SUPPORTED",
    note: "检索到的证据整体支持该命题。不代表绝对成立，仍受本报告列出的局限约束。",
  },
  partially_supported: {
    zh: "部分支持",
    en: "PARTIALLY SUPPORTED",
    note: "证据支持命题的某一部分，其余部分证据不足或存在限定条件。",
  },
  conflicting: {
    zh: "存在冲突",
    en: "CONFLICTING",
    note: "证据之间存在实质冲突。冲突不等于已证明为假，详见矛盾点说明。",
  },
  insufficient_evidence: {
    zh: "证据不足",
    en: "INSUFFICIENT EVIDENCE",
    note: "当前检索未获得足以判断的公开证据。本系统不因此断言真假。",
  },
};

/* ---------------- §7.3 调查状态 ---------------- */

export const INVESTIGATION_STATUSES = [
  "draft",
  "planning",
  "searching",
  "verifying",
  "synthesizing",
  "completed",
  "partial",
  "failed",
  "cancelled",
] as const;

export type InvestigationStatus = (typeof INVESTIGATION_STATUSES)[number];

/* ---------------- §12.3 搜索轮次类型 ---------------- */

export const ROUND_TYPES = [
  "initial",
  "official_source",
  "counter_evidence",
  "exception",
  "follow_up",
] as const;

export type RoundType = (typeof ROUND_TYPES)[number];

export type RoundStatus = "pending" | "running" | "succeeded" | "failed" | "empty";

/* ---------------- §6.4 搜索结果标准结构 ---------------- */

export interface SearchResult {
  id: string;
  title: string;
  url: string;
  snippet: string;
  publishedAt: string | null;
  siteName: string | null;
  relevanceScore: number | null;
  query: string;
  roundId: string;
  retrievedAt: string;
  /** 规范化后的去重键，仅内部使用；用户看到的永远是 url */
  canonicalUrl: string;
}

/* ---------------- §12.3 搜索轮次 ---------------- */

export interface SearchRound {
  id: string;
  investigationId: string;
  claimId: string | null;
  query: string;
  purpose: string;
  roundType: RoundType;
  status: RoundStatus;
  startedAt: string;
  completedAt: string | null;
  resultCount: number;
  selectedSourceIds: string[];
  openQuestions: string[];
  errorCode: string | null;
  errorMessage: string | null;
}

/* ---------------- §12.2 子命题 ---------------- */

export interface Claim {
  id: string;
  investigationId: string;
  text: string;
  purpose: string;
  status: "pending" | "searched" | "concluded";
  order: number;
  createdAt: string;
}

/* ---------------- §12.5 证据 ---------------- */

export interface Evidence {
  id: string;
  investigationId: string;
  claimId: string | null;
  sourceId: string;
  /** 系统依据搜索结果判断的关系 */
  relation: EvidenceRelation;
  reason: string;
  excerpt: string;
  verificationStatus: "verified" | "pending";
  independenceStatus: "independent" | "duplicate" | "reprint_suspected" | "unknown";
  limitations: string[];
  /** 用户手动分类（§12.5：与系统判断分开记录，不得混用） */
  userRelation: EvidenceRelation | null;
}

/* ---------------- §12.6 调查报告 ---------------- */

export interface ClaimFinding {
  claimId: string;
  claimText: string;
  resultStatus: ResultStatus;
  summary: string;
  evidenceIds: string[];
}

export interface Report {
  id: string;
  investigationId: string;
  title: string;
  originalClaim: string;
  scope: string;
  summary: string;
  resultStatus: ResultStatus;
  claimFindings: ClaimFinding[];
  supportEvidenceIds: string[];
  contradictEvidenceIds: string[];
  contextEvidenceIds: string[];
  contradictions: string[];
  limitations: string[];
  unresolvedQuestions: string[];
  nextSteps: string[];
  sourceRelationsNote: string;
  generatedAt: string;
  /** true = 本次调查未完成，报告不得显示为完整调查（§7.2 阶段 8） */
  incomplete: boolean;
  mode: InvestigationMode;
}

/* ---------------- §7.6 调查模式 ---------------- */

export type InvestigationMode = "model" | "rule";

/* ---------------- §12.1 调查任务 ---------------- */

export interface Investigation {
  id: string;
  originalClaim: string;
  status: InvestigationStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  scope: string;
  resultStatus: ResultStatus | null;
  reportId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  mode: InvestigationMode;
  searchCount: number;
  /** 截图查证来源标记 */
  origin: "text" | "screenshot";
}

export interface InvestigationBundle {
  investigation: Investigation;
  claims: Claim[];
  rounds: SearchRound[];
  sources: SearchResult[];
  evidence: Evidence[];
  report: Report | null;
}

/* ---------------- §6.6 搜索错误 ---------------- */

export const SEARCH_ERROR_CODES = {
  MISSING_KEY: "SEARCH_CONFIG_MISSING_KEY",
  UNAUTHORIZED: "SEARCH_AUTH_FAILED",
  TIMEOUT: "SEARCH_TIMEOUT",
  RATE_LIMITED: "SEARCH_RATE_LIMITED",
  BAD_RESPONSE: "SEARCH_BAD_RESPONSE",
  NETWORK: "SEARCH_NETWORK_ERROR",
  EMPTY: "SEARCH_NO_RESULTS",
  INVALID_QUERY: "SEARCH_INVALID_QUERY",
} as const;

export type SearchErrorCode =
  (typeof SEARCH_ERROR_CODES)[keyof typeof SEARCH_ERROR_CODES];

export interface SearchFailure {
  ok: false;
  code: SearchErrorCode;
  message: string;
  /** 仅供服务端日志，禁止下发到前端的敏感细节 */
  detail?: string;
}

export interface SearchSuccess {
  ok: true;
  results: SearchResult[];
  roundId: string;
  query: string;
  retrievedAt: string;
}

export type SearchOutcome = SearchSuccess | SearchFailure;
