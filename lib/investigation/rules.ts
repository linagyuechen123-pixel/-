/**
 * 规则化降级模式（§7.6 / §23.2）
 *
 * 当大模型不可用时使用。必须满足：
 * - 明确显示实际执行的规则
 * - 不得宣称已经完成大模型推理
 * - 不得自行生成来源
 */

import type {
  Claim,
  ClaimFinding,
  Evidence,
  Investigation,
  Report,
  RoundType,
  SearchResult,
  SearchRound,
} from "@/types/prism";

export const RULE_MODE_NOTICE =
  "当前处于规则化降级模式：命题拆分与查询计划由固定规则模板生成，系统未执行大模型语义推理。证据关系未经语义判断，统一标记为「待核验」，需由用户自行核对原文。";

const MAX_TOPIC_LENGTH = 48;

/** 取核心短语：不做语义改写，超长时按标点截取前段并显式标记截断 */
export function extractTopic(text: string): string {
  const t = text.trim();
  if (t.length <= MAX_TOPIC_LENGTH) return t;
  const cut = t.slice(0, MAX_TOPIC_LENGTH);
  const punct = Math.max(
    cut.lastIndexOf("，"),
    cut.lastIndexOf("。"),
    cut.lastIndexOf(","),
    cut.lastIndexOf(" "),
  );
  return punct > 16 ? cut.slice(0, punct) : cut;
}

export interface RuleClaimDraft {
  text: string;
  purpose: string;
}

/**
 * 规则化命题拆分：围绕同一说法生成 2–5 个可独立核验的子命题。
 * 规则固定：直接是否存在 / 官方说明 / 条件与限制 / 独立测试或第三方说法 / 时间效力。
 */
export function planClaimsRuleBased(originalClaim: string): RuleClaimDraft[] {
  const topic = extractTopic(originalClaim);
  return [
    {
      text: `「${topic}」这一说法本身是否在公开信息中被提出过？`,
      purpose: "核验该说法是否有公开出处，避免以不存在的说法为调查起点。",
    },
    {
      text: `是否有官方或权威来源直接说明「${topic}」？`,
      purpose: "优先寻找制造商、监管机构或一手机构的说明。",
    },
    {
      text: `是否存在限定条件、例外情况或适用范围限制？`,
      purpose: "检查该说法是否在特定条件下才成立。",
    },
    {
      text: `是否存在与该说法相反或提出质疑的公开信息？`,
      purpose: "执行反证检索，避免只寻找支持材料。",
    },
    {
      text: `该说法涉及的信息在近期是否发生变化？`,
      purpose: "检查时效性，避免依据过期信息下结论。",
    },
  ];
}

export interface PlannedQuery {
  roundType: RoundType;
  query: string;
  purpose: string;
}

/** 每个子命题最多 3 轮计划内搜索（§7.5） */
export function buildQueryPlan(claimText: string): PlannedQuery[] {
  const topic = extractTopic(claimText);
  const core = topic.replace(/[「」《》“"']/g, "").trim();
  return [
    {
      roundType: "initial",
      query: core.slice(0, 60),
      purpose: "精确短语检索：查找与该子命题直接对应的公开信息。",
    },
    {
      roundType: "counter_evidence",
      query: `${core.slice(0, 40)} 辟谣 争议 相反说法`.slice(0, 60),
      purpose: "反证检索：主动寻找相反解释或质疑材料。",
    },
    {
      roundType: "exception",
      query: `${core.slice(0, 40)} 例外 限制条件 不适用情况`.slice(0, 60),
      purpose: "边界检索：查找限定条件与例外情况。",
    },
  ];
}

/**
 * 规则化报告生成。
 * 不虚构任何结论：证据关系一律 unverified，结论状态按检索结果数量与轮次状态机械判定。
 */
export function buildRuleBasedReport(args: {
  investigation: Investigation;
  claims: Claim[];
  rounds: SearchRound[];
  sources: SearchResult[];
  searchCount: number;
}): Report {
  const { investigation, claims, rounds, sources, searchCount } = args;

  const succeededRounds = rounds.filter((r) => r.status === "succeeded");
  const failedRounds = rounds.filter((r) => r.status === "failed");
  const totalResults = succeededRounds.reduce((n, r) => n + r.resultCount, 0);

  let resultStatus: Report["resultStatus"] = "insufficient_evidence";
  if (sources.length === 0) {
    resultStatus = "insufficient_evidence";
  } else if (failedRounds.length > 0 && succeededRounds.length > 0) {
    resultStatus = "insufficient_evidence";
  } else if (sources.length > 0) {
    // 规则化模式不做语义判断，一律证据不足 + 待核验，由用户核对原文
    resultStatus = "insufficient_evidence";
  }

  const claimFindings: ClaimFinding[] = claims.map((c) => {
    const claimSources = sources.filter((s) => {
      const round = rounds.find((r) => r.id === s.roundId);
      return round?.claimId === c.id;
    });
    return {
      claimId: c.id,
      claimText: c.text,
      resultStatus,
      summary:
        claimSources.length === 0
          ? `本轮未检索到与该子命题相关的来源（已执行 ${rounds.filter((r) => r.claimId === c.id).length} 次搜索）。`
          : `检索到 ${claimSources.length} 条候选来源。规则化模式未对来源内容做语义判断，全部标记为待核验，请打开原文自行核对。`,
      evidenceIds: [],
    };
  });

  const limitations = [RULE_MODE_NOTICE];
  if (failedRounds.length > 0) {
    limitations.push(
      `有 ${failedRounds.length} 个搜索轮次执行失败，相关部分未获得来源，报告不构成完整调查。`,
    );
  }
  limitations.push(
    "本系统仅能检索公开可见的搜索结果，无法访问付费墙、数据库或未公开的一手材料。",
  );
  limitations.push(
    "搜索服务返回的摘要可能不完整或与原文存在偏差，结论需以原始网页为准。",
  );

  return {
    id: `RPT-${investigation.id}`,
    investigationId: investigation.id,
    title: `PRISM 调查报告：${extractTopic(investigation.originalClaim)}`,
    originalClaim: investigation.originalClaim,
    scope: investigation.scope,
    summary:
      sources.length === 0
        ? `本次调查共执行 ${searchCount} 次搜索，未获得任何可用来源，因此无法确认该说法。这不等同于该说法为假。`
        : `本次调查共执行 ${searchCount} 次搜索，获得 ${sources.length} 条去重后的候选来源。规则化模式不使用大模型推理，因此未对来源做支持/反对判断，全部证据标记为「待核验」。`,
    resultStatus,
    claimFindings,
    supportEvidenceIds: [],
    contradictEvidenceIds: [],
    contextEvidenceIds: [],
    contradictions: [],
    limitations,
    unresolvedQuestions: claims
      .filter(
        (c) =>
          !sources.some((s) => {
            const r = rounds.find((x) => x.id === s.roundId);
            return r?.claimId === c.id && r.status === "succeeded";
          }),
      )
      .map((c) => `尚未获得可核验来源：${c.text}`),
    nextSteps: [
      "打开下方每条来源的原始网页，逐条核对摘要与原文是否一致。",
      "在证据卡片中使用拖拽或下拉菜单手动标记「支持 / 反对 / 背景 / 待核验」。",
      "如需语义级别的证据判断，请在具备大模型能力的情况下重新执行调查。",
    ],
    sourceRelationsNote:
      `已对 ${totalResults} 条原始结果按规范化网址去重，最终保留 ${sources.length} 条。转载/聚合站点未被自动识别为独立来源，独立性标记为「未确认」。`,
    generatedAt: new Date().toISOString(),
    incomplete: failedRounds.length > 0 || searchCount === 0,
    mode: "rule",
  };
}

/** 规则化证据：不带任何关系判断 */
export function buildPlaceholderEvidence(
  investigationId: string,
  sources: SearchResult[],
  rounds: SearchRound[],
): Evidence[] {
  return sources.map((s) => {
    const round = rounds.find((r) => r.id === s.roundId);
    return {
      id: `E-${s.id}`,
      investigationId,
      claimId: round?.claimId ?? null,
      sourceId: s.id,
      relation: "unverified",
      reason: "规则化模式未执行语义判断，等待用户核对原文后手动分类。",
      excerpt: s.snippet.slice(0, 240),
      verificationStatus: "pending",
      independenceStatus: "unknown",
      limitations: [
        "证据关系未经系统判断。",
        "来源独立性未经确认。",
      ],
      userRelation: null,
    };
  });
}
