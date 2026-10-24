"use client";

/**
 * 深度调查引擎编排（客户端）
 *
 * 流程对应 §5.1 / §7.2：计划 → 第一轮 → 反证 → 例外 → 来源去重 → 证据整理 → 报告。
 * 所有搜索都通过 /api/search 由服务端真实调用元宝搜索。
 * 模型只参与计划、证据关系判断和报告撰写，永不产生来源。
 */

import {
  planClaimsWithModel,
  judgeEvidenceWithModel,
  synthesizeReportWithModel,
  isLlmFailure,
  type PlannedClaim,
} from "@/lib/llm/browser";
import {
  buildPlaceholderEvidence,
  buildQueryPlan,
  buildRuleBasedReport,
  planClaimsRuleBased,
  RULE_MODE_NOTICE,
  extractTopic,
} from "@/lib/investigation/rules";
import type {
  Claim,
  Evidence,
  Investigation,
  InvestigationBundle,
  Report,
  ResultStatus,
  SearchResult,
  SearchRound,
} from "@/types/prism";

export const MAX_ROUNDS_PER_CLAIM = 3;
export const MAX_TOTAL_SEARCHES = 12;

export type RunnerEvent =
  | { type: "phase"; status: Investigation["status"]; message: string }
  | { type: "round_start"; round: SearchRound }
  | { type: "round_done"; round: SearchRound; results: SearchResult[] }
  | { type: "round_error"; round: SearchRound; message: string }
  | { type: "log"; message: string; tone?: "info" | "warn" };

interface SearchApiSuccess {
  ok: true;
  results: SearchResult[];
}
interface SearchApiFailure {
  ok: false;
  code: string;
  message: string;
}
type SearchApiResponse = SearchApiSuccess | SearchApiFailure;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface PlannedBundle {
  claims: { text: string; purpose: string }[];
  plan: Map<number, { roundType: SearchRound["roundType"]; query: string; purpose: string }[]>;
  mode: "model" | "rule";
  modelNotice: string | null;
}

/**
 * 生成调查计划：优先使用大模型，失败则回退到规则化模式。
 * 回退必须在界面上显式可见。
 */
export async function createPlan(originalClaim: string): Promise<PlannedBundle> {
  const res = await planClaimsWithModel(originalClaim);
  if (!isLlmFailure(res)) {
    const claims = res.slice(0, 5).map((c: PlannedClaim) => ({
      text: c.text,
      purpose: c.purpose,
    }));
    const plan = new Map<number, PlannedBundle["plan"] extends Map<number, infer V> ? V : never>();
    res.slice(0, 5).forEach((c: PlannedClaim, i: number) => {
      plan.set(
        i,
        c.queries.slice(0, MAX_ROUNDS_PER_CLAIM).map((q) => ({
          roundType: q.roundType,
          query: q.query,
          purpose: q.purpose,
        })),
      );
    });
    // 保证每个子命题至少有 1 条反证查询（§7.2 阶段 5）
    plan.forEach((queries, idx) => {
      if (!queries.some((q) => q.roundType === "counter_evidence")) {
        const topic = extractTopic(claims[idx]?.text ?? originalClaim);
        queries.push({
          roundType: "counter_evidence",
          query: `${topic.slice(0, 40)} 辟谣 争议 相反说法`.slice(0, 60),
          purpose: "补充反证检索，避免只寻找支持材料。",
        });
      }
    });
    return { claims, plan, mode: "model", modelNotice: null };
  }

  const drafted = planClaimsRuleBased(originalClaim);
  const plan = new Map<number, PlannedBundle["plan"] extends Map<number, infer V> ? V : never>();
  drafted.forEach((_, i) => {
    plan.set(
      i,
      buildQueryPlan(drafted[i].text).slice(0, MAX_ROUNDS_PER_CLAIM),
    );
  });
  return {
    claims: drafted.map((d) => ({ text: d.text, purpose: d.purpose })),
    plan,
    mode: "rule",
    modelNotice: `大模型不可用（${res.code}），已切换到规则化降级模式。${RULE_MODE_NOTICE}`,
  };
}

export interface RunOptions {
  investigationId: string;
  originalClaim: string;
  claimDrafts: { text: string; purpose: string }[];
  plan: Map<number, { roundType: SearchRound["roundType"]; query: string; purpose: string }[]>;
  mode: "model" | "rule";
  modelNotice: string | null;
  origin: Investigation["origin"];
  onEvent: (e: RunnerEvent) => void;
  signal: AbortSignal;
}

export async function executeInvestigation(
  opts: RunOptions,
): Promise<InvestigationBundle> {
  const now = () => new Date().toISOString();
  const startedAt = now();

  const investigation: Investigation = {
    id: opts.investigationId,
    originalClaim: opts.originalClaim,
    status: "planning",
    createdAt: startedAt,
    updatedAt: startedAt,
    completedAt: null,
    scope: opts.claimDrafts.map((c) => c.text).join(" / "),
    resultStatus: null,
    reportId: null,
    errorCode: null,
    errorMessage: null,
    mode: opts.mode,
    searchCount: 0,
    origin: opts.origin,
  };

  const claims: Claim[] = opts.claimDrafts.map((c, i) => ({
    id: `C-${opts.investigationId}-${i + 1}`,
    investigationId: opts.investigationId,
    text: c.text,
    purpose: c.purpose,
    status: "pending",
    order: i + 1,
    createdAt: now(),
  }));

  if (opts.modelNotice) {
    opts.onEvent({ type: "log", message: opts.modelNotice, tone: "warn" });
  }

  const rounds: SearchRound[] = [];
  const sources: SearchResult[] = [];
  const seenCanonical = new Set<string>();

  opts.onEvent({
    type: "phase",
    status: "searching",
    message: `开始执行真实搜索，共 ${claims.length} 个子命题。`,
  });

  let searchCount = 0;
  let budgetStopped = false;

  outer: for (let ci = 0; ci < claims.length; ci++) {
    const claim = claims[ci];
    const planned = opts.plan.get(ci) ?? [];
    for (let qi = 0; qi < planned.length; qi++) {
      if (opts.signal.aborted) {
        opts.onEvent({ type: "log", message: "用户取消了调查。", tone: "warn" });
        break outer;
      }
      if (qi >= MAX_ROUNDS_PER_CLAIM) break;
      if (searchCount >= MAX_TOTAL_SEARCHES) {
        budgetStopped = true;
        opts.onEvent({
          type: "log",
          message: `已达到本次调查的搜索上限（${MAX_TOTAL_SEARCHES} 次），自动停止后续搜索。`,
          tone: "warn",
        });
        break outer;
      }

      const p = planned[qi];
      const roundId = `R-${opts.investigationId}-${ci + 1}-${qi + 1}`;
      const round: SearchRound = {
        id: roundId,
        investigationId: opts.investigationId,
        claimId: claim.id,
        query: p.query,
        purpose: p.purpose,
        roundType: p.roundType,
        status: "running",
        startedAt: now(),
        completedAt: null,
        resultCount: 0,
        selectedSourceIds: [],
        openQuestions: [],
        errorCode: null,
        errorMessage: null,
      };
      rounds.push(round);
      searchCount += 1;
      opts.onEvent({ type: "round_start", round });

      const started = Date.now();
      let apiResponse: SearchApiResponse;
      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: p.query,
            roundId,
            roundType: p.roundType,
            cnt: 10,
          }),
          signal: opts.signal,
        });
        apiResponse = (await res.json()) as SearchApiResponse;
      } catch (err) {
        const aborted = err instanceof Error && err.name === "AbortError";
        apiResponse = {
          ok: false,
          code: "SEARCH_NETWORK_ERROR",
          message: aborted ? "请求已取消。" : "无法连接到本地服务端，搜索未完成。",
        };
      }

      const elapsed = Date.now() - started;
      // 避免连续请求过快触发限流
      if (elapsed < 300) await sleep(300 - elapsed);

      if (!apiResponse.ok) {
        round.status = "failed";
        round.errorCode = apiResponse.code;
        round.errorMessage = apiResponse.message;
        round.completedAt = now();
        opts.onEvent({ type: "round_error", round, message: apiResponse.message });
        continue;
      }

      const fresh = apiResponse.results.filter((r) => {
        if (seenCanonical.has(r.canonicalUrl)) return false;
        seenCanonical.add(r.canonicalUrl);
        return true;
      });

      round.resultCount = fresh.length;
      round.status = fresh.length === 0 ? "empty" : "succeeded";
      round.completedAt = now();
      round.selectedSourceIds = fresh.map((r) => r.id);
      if (fresh.length === 0) {
        round.openQuestions.push("该查询未返回任何可用来源。");
      }
      sources.push(...fresh);
      claim.status = "searched";

      opts.onEvent({ type: "round_done", round, results: fresh });
    }
  }

  investigation.searchCount = searchCount;

  opts.onEvent({
    type: "phase",
    status: "verifying",
    message: `搜索阶段结束，共获得 ${sources.length} 条去重来源，正在整理证据关系。`,
  });

  let evidence: Evidence[] = [];
  let report: Report;

  if (opts.mode === "model" && sources.length > 0) {
    const judgeRes = await judgeEvidenceWithModel({
      originalClaim: opts.originalClaim,
      claims: claims.map((c) => ({ id: c.id, text: c.text })),
      sources: sources.map((s) => {
        const r = rounds.find((x) => x.id === s.roundId);
        return {
          id: s.id,
          title: s.title,
          url: s.url,
          snippet: s.snippet,
          siteName: s.siteName,
          publishedAt: s.publishedAt,
          claimId: r?.claimId ?? null,
        };
      }),
    });

    if (!isLlmFailure(judgeRes)) {
      const judged = new Map(judgeRes.map((j) => [j.sourceId, j]));
      evidence = sources.map((s) => {
        const round = rounds.find((r) => r.id === s.roundId);
        const j = judged.get(s.id);
        return {
          id: `E-${s.id}`,
          investigationId: opts.investigationId,
          claimId: round?.claimId ?? null,
          sourceId: s.id,
          relation: j?.relation ?? "unverified",
          reason:
            j?.reason ??
            "模型未对该来源给出判断，保持待核验状态，需人工核对原文。",
          excerpt: (j?.excerpt ?? s.snippet).slice(0, 240),
          verificationStatus: j ? "verified" : "pending",
          independenceStatus: "unknown",
          limitations: j
            ? ["关系判断基于搜索摘要，摘要可能不完整。", "来源独立性未经自动确认。"]
            : ["未获得模型判断，需人工核实。"],
          userRelation: null,
        } satisfies Evidence;
      });
    } else {
      opts.onEvent({
        type: "log",
        message: `证据关系模型判断失败（${judgeRes.code}），全部证据标记为待核验。`,
        tone: "warn",
      });
      evidence = buildPlaceholderEvidence(opts.investigationId, sources, rounds);
    }
  } else {
    evidence = buildPlaceholderEvidence(opts.investigationId, sources, rounds);
  }

  const failedRoundCount = rounds.filter((r) => r.status === "failed").length;
  const roundSummary = rounds
    .map(
      (r) =>
        `[${r.roundType}] ${r.query} → ${r.status}，${r.resultCount} 条来源${r.errorMessage ? `，错误：${r.errorMessage}` : ""}`,
    )
    .join("\n");

  let reportDraft: Awaited<
    ReturnType<typeof synthesizeReportWithModel>
  > | null = null;

  if (opts.mode === "model" && sources.length > 0) {
    const r = await synthesizeReportWithModel({
      originalClaim: opts.originalClaim,
      claims: claims.map((c) => ({ id: c.id, text: c.text })),
      sources,
      judgements: evidence.map((e) => ({
        sourceId: e.sourceId,
        relation: e.relation as "supports" | "contradicts" | "context" | "unverified",
        reason: e.reason,
        excerpt: e.excerpt,
      })),
      roundSummary,
      searchCount,
      failedRoundCount,
    });
    if (!isLlmFailure(r)) reportDraft = r;
    else {
      opts.onEvent({
        type: "log",
        message: `报告模型生成失败（${r.code}），改用结构化模板生成报告。`,
        tone: "warn",
      });
    }
  }

  const effectiveMode =
    opts.mode === "model" && reportDraft ? "model" : "rule";

  if (reportDraft) {
    const resultStatus = reportDraft.resultStatus as ResultStatus;
    const byRelation = (rel: string) =>
      evidence.filter((e) => e.relation === rel).map((e) => e.id);
    report = {
      id: `RPT-${opts.investigationId}`,
      investigationId: opts.investigationId,
      title: reportDraft.title || `PRISM 调查报告：${extractTopic(opts.originalClaim)}`,
      originalClaim: opts.originalClaim,
      scope: reportDraft.scope || investigation.scope,
      summary: reportDraft.summary,
      resultStatus,
      claimFindings: claims.map((c) => {
        const found = reportDraft.claimFindings.find((f) => f.claimId === c.id);
        return {
          claimId: c.id,
          claimText: c.text,
          resultStatus: (found?.resultStatus ?? "insufficient_evidence") as ResultStatus,
          summary:
            found?.summary ??
            "模型未针对该子命题输出结论，需查看下方来源自行核对。",
          evidenceIds: evidence.filter((e) => e.claimId === c.id).map((e) => e.id),
        };
      }),
      supportEvidenceIds: byRelation("supports"),
      contradictEvidenceIds: byRelation("contradicts"),
      contextEvidenceIds: byRelation("context"),
      contradictions: reportDraft.contradictions,
      limitations: mergeLimitations(reportDraft.limitations, opts, failedRoundCount, searchCount, sources.length),
      unresolvedQuestions: reportDraft.unresolvedQuestions,
      nextSteps: reportDraft.nextSteps,
      sourceRelationsNote:
        reportDraft.sourceRelationsNote ||
        `已按规范化网址对 ${rounds.reduce((n, r) => n + r.resultCount, 0)} 条原始结果去重，保留 ${sources.length} 条。转载站点未被自动识别为独立来源。`,
      generatedAt: now(),
      incomplete: failedRoundCount > 0 || searchCount === 0,
      mode: "model",
    };
  } else {
    const base = buildRuleBasedReport({
      investigation,
      claims,
      rounds,
      sources,
      searchCount,
    });
    report = {
      ...base,
      mode: "rule",
      limitations: mergeLimitations(base.limitations, opts, failedRoundCount, searchCount, sources.length),
    };
  }

  investigation.mode = effectiveMode;
  investigation.resultStatus = report.resultStatus;
  investigation.reportId = report.id;
  investigation.scope = report.scope || investigation.scope;
  investigation.updatedAt = now();
  investigation.completedAt = now();
  investigation.status =
    failedRoundCount > 0 && rounds.filter((r) => r.status === "succeeded").length > 0
      ? "partial"
      : failedRoundCount === rounds.length && rounds.length > 0
        ? "failed"
        : sources.length === 0
          ? "partial"
          : "completed";

  if (budgetStopped) {
    opts.onEvent({
      type: "log",
      message: "注意：本次调查因达到搜索预算上限提前结束，报告覆盖范围不完整。",
      tone: "warn",
    });
  }

  opts.onEvent({
    type: "phase",
    status: investigation.status,
    message: `调查结束，结论状态：${report.resultStatus}。`,
  });

  return {
    investigation,
    claims,
    rounds,
    sources,
    evidence,
    report,
  };
}

function mergeLimitations(
  base: string[],
  opts: RunOptions,
  failedRoundCount: number,
  searchCount: number,
  sourceCount: number,
): string[] {
  const out = [...base];
  if (opts.modelNotice) out.unshift(opts.modelNotice);
  if (failedRoundCount > 0) {
    out.push(
      `有 ${failedRoundCount}/${searchCount} 个搜索轮次失败，相关部分未获得来源。`,
    );
  }
  if (sourceCount === 0) {
    out.push("本次调查未获得任何可用来源，无法对命题作出判断。");
  }
  out.push(
    "搜索摘要可能与原文存在差异，所有结论应以原始网页为准；本系统不对来源内容做任何改动或担保。",
  );
  out.push(
    "调查记录仅保存在当前浏览器本地，清除浏览器数据或更换设备后不可恢复。",
  );
  return Array.from(new Set(out)).slice(0, 12);
}
