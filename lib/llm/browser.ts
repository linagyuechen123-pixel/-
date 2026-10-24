"use client";

/**
 * 大模型调用封装（浏览器端）
 * 依据 §7.6：模型只协助拆分命题、生成查询词、提出反证方向、整理证据关系、编写报告草稿。
 * 模型不得生成来源；所有来源必须来自真实搜索返回值。
 *
 * SDK 只允许流式调用，因此统一使用 stream:true 手动拼接完整文本。
 * 每个 create() 调用的首条消息必须是 system 消息。
 */

import { createWorkBuddyCloud } from "@tencent-ai/workbuddy-cloud-sdk";
import {
  CLOUD_PUBLIC_CONFIG,
  DEFAULT_MODEL_ID,
  FALLBACK_MODEL_ID,
} from "@/lib/cloud/config";
import type { RoundType, SearchResult } from "@/types/prism";

let cloudClient: ReturnType<typeof createWorkBuddyCloud> | null = null;

function getClient() {
  if (!cloudClient) {
    cloudClient = createWorkBuddyCloud({
      endpoint: CLOUD_PUBLIC_CONFIG.endpoint,
      publishableKey: CLOUD_PUBLIC_CONFIG.publishableKey,
    });
  }
  return cloudClient;
}

export interface LlmFailure {
  ok: false;
  code: string;
  message: string;
}

export function isLlmFailure(v: unknown): v is LlmFailure {
  return typeof v === "object" && v !== null && (v as LlmFailure).ok === false;
}

const SYSTEM_PLANNER = [
  "你是 PRISM 事实调查系统的命题规划器。",
  "职责：把一个待核验的说法拆分为可独立核验的子命题，并为每个子命题设计查询词。",
  "硬约束：",
  "1. 只能返回 JSON，不要输出解释、注释或 Markdown 代码块。",
  "2. 严禁编造任何事实、数据、结论或来源链接；你只需要拆问题，不需回答对错。",
  "3. 子命题数量 2-5 个，每个必须是可被公开信息独立核验的事实问题，不得是含多个事实的长句。",
  "4. 严禁改动原始说法的含义。",
  "5. 查询词必须是中文或英文检索词，长度不超过 60 字符，不得包含布尔运算符。",
  "6. 每个子命题必须包含至少一条 counter_evidence 类型的反证查询。",
].join("\n");

const SYSTEM_EVIDENCE = [
  "你是 PRISM 事实调查系统的证据整理器。",
  "硬约束：",
  "1. 只能依据用户提供的搜索摘要判断，禁止使用你自己的知识补充事实。",
  "2. relation 只能取 supports / contradicts / context / unverified 之一。",
  "3. 摘要不足以判断时必须使用 unverified，不得猜测。",
  "4. 严禁生成来源、网址或标题；只允许引用用户给出的 sourceId。",
  "5. 只返回 JSON。",
].join("\n");

const SYSTEM_REPORT = [
  "你是 PRISM 事实调查系统的报告撰写器。",
  "硬约束：",
  "1. 只依据提供的搜索证据写作，禁止引入未在证据中出现的事实、日期或机构名称。",
  "2. resultStatus 只能取 supported / partially_supported / conflicting / insufficient_evidence。",
  "3. 「冲突」不等于「已证明为假」，不得使用「已证伪」「是假的」等结论性措辞。",
  "4. 证据不足时必须明确写出还缺少什么信息。",
  "5. 只返回 JSON。",
].join("\n");

function stripFences(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  }
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  return s;
}

async function runJsonPrompt<T>(
  system: string,
  prompt: string,
  validator: (v: unknown) => T | null,
  options?: { maxTokens?: number; modelId?: string },
): Promise<T | LlmFailure> {
  const cloud = getClient();
  let acc = "";

  const attempt = async (modelId: string) => {
    acc = "";
    const iterator = await cloud.llm.chat.completions.create({
      model: modelId,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      stream: true,
      temperature: 0.2,
    });
    for await (const chunk of iterator) {
      const delta = chunk.choices[0]?.delta;
      const piece = delta?.content;
      if (typeof piece === "string") acc += piece;
    }
  };

  try {
    await attempt(options?.modelId ?? DEFAULT_MODEL_ID);
  } catch (err) {
    const code = readErrCode(err);
    if (isRetriable(code)) {
      try {
        await attempt(FALLBACK_MODEL_ID);
      } catch (err2) {
        return {
          ok: false,
          code: readErrCode(err2),
          message: llmErrorMessage(readErrCode(err2)),
        };
      }
    } else {
      return { ok: false, code, message: llmErrorMessage(code) };
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(acc));
  } catch {
    return { ok: false, code: "llm_bad_json", message: "模型返回内容无法解析为结构化数据。" };
  }

  const validated = validator(parsed);
  if (!validated) {
    return {
      ok: false,
      code: "llm_schema_mismatch",
      message: "模型返回结构与预期不符，本次未采用模型输出。",
    };
  }
  return validated;
}

function readErrCode(err: unknown): string {
  const e = err as {
    error?: { code?: string | null };
    code?: string;
    name?: string;
  };
  if (e?.error?.code) return String(e.error.code);
  if (e?.code) return String(e.code);
  if (e?.name === "AbortError") return "request_aborted";
  return "internal_unknown";
}

function isRetriable(code: string): boolean {
  return code.startsWith("model_") || code.startsWith("gateway_");
}

export function llmErrorMessage(code: string): string {
  if (code.startsWith("auth_")) return "大模型凭据校验失败（应用来源不匹配或已失效）。";
  if (code.startsWith("quota_")) return "大模型额度已用尽或被限流。";
  if (code.startsWith("model_") || code.startsWith("gateway_"))
    return "大模型服务暂时不可用。";
  if (code === "request_aborted") return "模型请求已取消。";
  return "大模型调用失败。";
}

/* ---------------- §7.2 阶段 2-3：命题拆分与查询计划 ---------------- */

export interface PlannedClaim {
  text: string;
  purpose: string;
  queries: { roundType: RoundType; query: string; purpose: string }[];
}

const ROUND_TYPE_SET = new Set<string>([
  "initial",
  "official_source",
  "counter_evidence",
  "exception",
  "follow_up",
]);

function validatePlannedClaims(v: unknown): PlannedClaim[] | null {
  const root = v as { claims?: unknown };
  const list = Array.isArray(root?.claims) ? root.claims : null;
  if (!list || list.length === 0 || list.length > 5) return null;

  const out: PlannedClaim[] = [];
  for (const item of list) {
    const c = item as {
      text?: unknown;
      purpose?: unknown;
      queries?: unknown;
    };
    const text = typeof c.text === "string" ? c.text.trim() : "";
    if (!text || text.length > 200) return null;
    const queriesRaw = Array.isArray(c.queries) ? c.queries : [];
    const queries: PlannedClaim["queries"] = [];
    for (const q of queriesRaw) {
      const qq = q as { roundType?: unknown; query?: unknown; purpose?: unknown };
      const query = typeof qq.query === "string" ? qq.query.trim() : "";
      if (!query || query.length > 60) continue;
      const rt =
        typeof qq.roundType === "string" && ROUND_TYPE_SET.has(qq.roundType)
          ? (qq.roundType as RoundType)
          : "initial";
      queries.push({
        roundType: rt,
        query,
        purpose: typeof qq.purpose === "string" ? qq.purpose.trim().slice(0, 200) : "",
      });
    }
    if (queries.length === 0) return null;
    out.push({
      text,
      purpose: typeof c.purpose === "string" ? c.purpose.trim().slice(0, 300) : "",
      queries,
    });
  }
  return out.length > 0 ? out : null;
}

export async function planClaimsWithModel(originalClaim: string) {
  const prompt = [
    "请处理以下待核验说法：",
    `原始说法：${originalClaim}`,
    "为每个子命题设计 2-3 条查询词，roundType 从以下取值中选择：",
    "initial（基础检索）、official_source（官方/一手来源）、counter_evidence（反证）、exception（例外与限定条件）、follow_up（追问）",
    "输出 JSON：",
    '{"claims":[{"text":"子命题","purpose":"核验目的","queries":[{"roundType":"initial","query":"检索词","purpose":"该查询要解决的问题"}]}]}',
  ].join("\n");

  return runJsonPrompt(SYSTEM_PLANNER, prompt, validatePlannedClaims);
}

/* ---------------- §7.2 阶段 7：证据关系 ---------------- */

export interface EvidenceJudgement {
  sourceId: string;
  relation: "supports" | "contradicts" | "context" | "unverified";
  reason: string;
  excerpt: string;
}

function validateJudgements(v: unknown): EvidenceJudgement[] | null {
  const root = v as { judgements?: unknown };
  const list = Array.isArray(root?.judgements) ? root.judgements : null;
  if (!list) return null;
  const out: EvidenceJudgement[] = [];
  for (const item of list) {
    const j = item as {
      sourceId?: unknown;
      relation?: unknown;
      reason?: unknown;
      excerpt?: unknown;
    };
    if (typeof j.sourceId !== "string") return null;
    if (!["supports", "contradicts", "context", "unverified"].includes(
      j.relation as string,
    ))
      return null;
    out.push({
      sourceId: j.sourceId,
      relation: j.relation as EvidenceJudgement["relation"],
      reason: typeof j.reason === "string" ? j.reason.slice(0, 400) : "",
      excerpt: typeof j.excerpt === "string" ? j.excerpt.slice(0, 400) : "",
    });
  }
  return out;
}

export async function judgeEvidenceWithModel(args: {
  originalClaim: string;
  claims: { id: string; text: string }[];
  sources: {
    id: string;
    title: string;
    url: string;
    snippet: string;
    siteName: string | null;
    publishedAt: string | null;
    claimId: string | null;
  }[];
}) {
  const sourceLines = args.sources
    .map(
      (s, i) =>
        `[${i + 1}] sourceId=${s.id} claimId=${s.claimId ?? "none"}\n标题：${s.title}\n站点：${s.siteName ?? "未知"}\n日期：${s.publishedAt ?? "未知"}\n摘要：${s.snippet.slice(0, 400)}`,
    )
    .join("\n\n");

  const prompt = [
    `原始说法：${args.originalClaim}`,
    "",
    "子命题：",
    ...args.claims.map((c, i) => `${i + 1}. (${c.id}) ${c.text}`),
    "",
    "以下为真实搜索返回的来源摘要（只能依据这些内容判断）：",
    sourceLines,
    "",
    "输出 JSON：",
    '{"judgements":[{"sourceId":"S-...","relation":"supports|contradicts|context|unverified","reason":"判断依据，不超过 100 字","excerpt":"引用的原文片段（必须来自上面的摘要）"}]}',
  ].join("\n");

  return runJsonPrompt(SYSTEM_EVIDENCE, prompt, validateJudgements);
}

/* ---------------- §7.2 阶段 8：报告 ---------------- */

export interface ReportDraft {
  title: string;
  scope: string;
  summary: string;
  resultStatus: "supported" | "partially_supported" | "conflicting" | "insufficient_evidence";
  claimFindings: { claimId: string; resultStatus: string; summary: string }[];
  contradictions: string[];
  limitations: string[];
  unresolvedQuestions: string[];
  nextSteps: string[];
  sourceRelationsNote: string;
}

/**
 * 清除模型输出中的客套/拒答短语（如「我不知道，这超出了我的能力范围」）。
 * 这类短语不是调查结论，出现在报告字段中会误导用户（§8.5：报告不得包含与调查无关的内容）。
 * 仅做短语移除，不生成任何新内容；清洗后为空的字段按缺失处理。
 */
const REFUSAL_PHRASES = [
  "我不知道，这超出了我的能力范围",
  "这超出了我的能力范围",
  "我不知道。",
  "作为一个AI，",
  "作为AI，",
  "作为一个人工智能，",
  "我无法回答这个问题。",
];

function stripRefusalBoilerplate(s: string): string {
  let out = s;
  for (const p of REFUSAL_PHRASES) out = out.split(p).join("");
  // 清理残留的孤立标点与空白
  return out
    .replace(/^[，。；、\s]+/, "")
    .replace(/[，。；、]{2,}/g, "。")
    .trim();
}

function validateReportDraft(v: unknown): ReportDraft | null {
  const r = v as Record<string, unknown>;
  const okStatus = [
    "supported",
    "partially_supported",
    "conflicting",
    "insufficient_evidence",
  ];
  if (typeof r.summary !== "string") return null;
  if (!okStatus.includes(r.resultStatus as string)) return null;
  const summary = stripRefusalBoilerplate(r.summary as string);
  // 核心结论被清空说明模型没有真正输出内容，按无效输出处理（回退规则化模式）
  if (summary.length < 8) return null;
  const findings = Array.isArray(r.claimFindings) ? r.claimFindings : [];
  const arr = (x: unknown, max = 8, len = 300): string[] =>
    Array.isArray(x)
      ? x
          .filter((i): i is string => typeof i === "string")
          .map(stripRefusalBoilerplate)
          .filter((s) => s.length > 0)
          .slice(0, max)
          .map((s) => s.slice(0, len))
      : [];

  return {
    title: typeof r.title === "string" ? r.title.slice(0, 120) : "PRISM 调查报告",
    scope: typeof r.scope === "string" ? stripRefusalBoilerplate(r.scope).slice(0, 300) : "",
    summary: summary.slice(0, 1200),
    resultStatus: r.resultStatus as ReportDraft["resultStatus"],
    claimFindings: findings
      .map((f) => {
        const o = f as { claimId?: unknown; resultStatus?: unknown; summary?: unknown };
        return {
          claimId: typeof o.claimId === "string" ? o.claimId : "",
          resultStatus: okStatus.includes(o.resultStatus as string)
            ? (o.resultStatus as string)
            : "insufficient_evidence",
          summary:
            typeof o.summary === "string"
              ? stripRefusalBoilerplate(o.summary).slice(0, 600)
              : "",
        };
      })
      .filter((f) => f.claimId),
    contradictions: arr(r.contradictions),
    limitations: arr(r.limitations, 10),
    unresolvedQuestions: arr(r.unresolvedQuestions, 10),
    nextSteps: arr(r.nextSteps, 10),
    sourceRelationsNote:
      typeof r.sourceRelationsNote === "string"
        ? stripRefusalBoilerplate(r.sourceRelationsNote).slice(0, 600)
        : "",
  };
}

export async function synthesizeReportWithModel(args: {
  originalClaim: string;
  claims: { id: string; text: string }[];
  sources: SearchResult[];
  judgements: EvidenceJudgement[];
  roundSummary: string;
  searchCount: number;
  failedRoundCount: number;
}) {
  const sourceLines = args.sources
    .map(
      (s) =>
        `- ${s.id} | ${s.title} | ${s.siteName ?? "未知站点"} | ${s.url} | ${s.snippet.slice(0, 300)}`,
    )
    .join("\n");

  const judgementLines = args.judgements
    .map(
      (j) =>
        `- ${j.sourceId} → ${j.relation}：${j.reason}${j.excerpt ? `（摘录：${j.excerpt.slice(0, 160)}）` : ""}`,
    )
    .join("\n");

  const prompt = [
    `原始说法：${args.originalClaim}`,
    "",
    "子命题：",
    ...args.claims.map((c) => `- (${c.id}) ${c.text}`),
    "",
    "调查执行记录：",
    args.roundSummary,
    `共执行 ${args.searchCount} 次搜索，其中失败 ${args.failedRoundCount} 次。`,
    "",
    "真实来源清单（只允许引用这里出现的来源，禁止新增来源）：",
    sourceLines,
    "",
    "系统整理的证据关系：",
    judgementLines,
    "",
    "输出 JSON：",
    '{"title":"报告标题","scope":"调查范围","summary":"核心结论摘要","resultStatus":"supported|partially_supported|conflicting|insufficient_evidence","claimFindings":[{"claimId":"...","resultStatus":"...","summary":"..."}],"contradictions":["矛盾点"],"limitations":["调查局限"],"unresolvedQuestions":["尚未解决的问题"],"nextSteps":["后续核验建议"],"sourceRelationsNote":"来源关系说明"}',
  ].join("\n");

  return runJsonPrompt(SYSTEM_REPORT, prompt, validateReportDraft);
}
