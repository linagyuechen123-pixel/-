"use client";

/**
 * 持续盯梢的复查引擎（§10）
 *
 * 诚实实现边界：
 * - 每次复查都真实调用 /api/search（服务端持有密钥的元宝搜索），不做任何预置数据。
 * - 没有服务端定时任务，也没有数据库：自动复查只在**页面保持打开**时按间隔触发，
 *   页面关闭或无人打开时不执行，历史快照存在浏览器 localStorage。
 * - 「未再检索到」不等于「来源已删除」：搜索引擎返回集合本身有波动，措辞必须保留这层不确定性。
 */

import { assessDeltaWithModel, isLlmFailure } from "@/lib/llm/browser";
import type {
  ResultStatus,
  SearchResult,
  SearchRound,
  WatchDiff,
  WatchSnapshot,
  WatchSnapshotSource,
  WatchTarget,
} from "@/types/prism";

/** 复查时最多执行几条查询词（控制额度与耗时） */
export const MAX_WATCH_QUERIES = 3;
/**
 * 复查的检索时间窗（元宝搜索 Freshness 参数）。
 * 实测可用取值：d（当天）、d7（近 7 天）、m1（近一月）、y1（近一年）；w/w1 接口不接受。
 * 限定时间窗后「新增来源」才有意义：盯梢要看的是最近有没有出现新说法、新证据，
 * 而不是把同一批查询词再跑一遍拿到几乎相同的旧结果。
 */
export const WATCH_FRESHNESS = "d7";
/** 快照里保留展示用的来源条数 */
const MAX_TOP_SOURCES = 8;
/** 交给模型做增量评估的新增来源上限 */
const MAX_ASSESS_SOURCES = 12;
/** 每条查询之间的最小间隔，避免触发限流 */
const MIN_INTERVAL_MS = 300;

interface SearchApiResponse {
  ok: boolean;
  code?: string;
  message?: string;
  results?: SearchResult[];
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function toSnapshotSource(s: SearchResult): WatchSnapshotSource {
  return {
    title: s.title,
    url: s.url,
    siteName: s.siteName,
    publishedAt: s.publishedAt,
  };
}

/**
 * 从一次完整调查里挑出复查用的查询词：
 * 优先取各子命题的 initial 查询，不足时退回原始说法本身。
 */
export function buildWatchQueries(
  rounds: SearchRound[],
  originalClaim: string,
): string[] {
  const picked: string[] = [];
  const seen = new Set<string>();
  for (const r of rounds) {
    if (r.roundType !== "initial") continue;
    const q = r.query.trim();
    if (!q || seen.has(q)) continue;
    seen.add(q);
    picked.push(q);
    if (picked.length >= MAX_WATCH_QUERIES) break;
  }
  if (picked.length === 0) {
    picked.push(originalClaim.trim().slice(0, 60));
  }
  return picked;
}

/**
 * 由一次完整调查生成初始快照（不额外消耗搜索额度）。
 *
 * 关键：基线只取「复查要用的那几条查询词」在本次调查中实际检索到的来源，
 * 而不是整次调查的全部来源。否则基线是十几轮的结果、复查只有三轮，
 * 口径不对等，diff 会稳定输出「新增 0 条」，盯梢就失去意义。
 */
export function snapshotFromBundle(args: {
  claim: string;
  resultStatus: ResultStatus | null;
  rounds: SearchRound[];
  sources: SearchResult[];
  queries: string[];
}): WatchSnapshot {
  const querySet = new Set(args.queries.map((q) => q.trim()));
  const matchedRoundIds = new Set(
    args.rounds
      .filter((r) => querySet.has(r.query.trim()))
      .map((r) => r.id),
  );
  const baseline =
    args.sources.filter((s) => matchedRoundIds.has(s.roundId)).length > 0
      ? args.sources.filter((s) => matchedRoundIds.has(s.roundId))
      : args.sources;

  return {
    takenAt: new Date().toISOString(),
    queries: args.queries,
    freshness: "",
    resultStatus: args.resultStatus,
    sourceUrls: baseline.map((s) => s.canonicalUrl),
    topSources: baseline.slice(0, MAX_TOP_SOURCES).map(toSnapshotSource),
    searchCount: matchedRoundIds.size || args.rounds.length,
    failedCount: args.rounds.filter(
      (r) => matchedRoundIds.has(r.id) && r.status === "failed",
    ).length,
    error: null,
  };
}

export function createWatchTarget(args: {
  investigationId: string;
  claim: string;
  rounds: SearchRound[];
  sources: SearchResult[];
  resultStatus: ResultStatus | null;
}): WatchTarget {
  const queries = buildWatchQueries(args.rounds, args.claim);
  const snapshot = snapshotFromBundle({
    claim: args.claim,
    resultStatus: args.resultStatus,
    rounds: args.rounds,
    sources: args.sources,
    queries,
  });
  const now = new Date().toISOString();
  return {
    id: `W-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    investigationId: args.investigationId,
    claim: args.claim,
    createdAt: now,
    lastCheckedAt: now,
    intervalMinutes: 60,
    autoEnabled: false,
    queries,
    snapshots: [snapshot],
    lastDiff: null,
  };
}

export interface RecheckResult {
  target: WatchTarget;
  diff: WatchDiff;
}

/**
 * 对一个盯梢目标执行一次真实复查：
 * 跑保存下来的查询词 → 去重 → 与上次快照比对 → 有新增证据时用模型判断是否足以改变结论。
 */
export async function recheckTarget(
  target: WatchTarget,
  opts?: { signal?: AbortSignal; withAssessment?: boolean },
): Promise<RecheckResult> {
  const withAssessment = opts?.withAssessment !== false;

  const collected: SearchResult[] = [];
  const byCanonical = new Map<string, SearchResult>();
  let failedCount = 0;
  let firstError: string | null = null;

  for (let i = 0; i < target.queries.length; i += 1) {
    const query = target.queries[i];
    const roundId = `W-${target.id}-${Date.now()}-${i + 1}`;
    let resp: SearchApiResponse;
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          roundId,
          roundType: "follow_up",
          cnt: 10,
          freshness: WATCH_FRESHNESS,
        }),
        signal: opts?.signal,
      });
      resp = (await res.json()) as SearchApiResponse;
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      resp = {
        ok: false,
        code: "SEARCH_NETWORK_ERROR",
        message: aborted ? "请求已取消。" : "无法连接到服务端，本次复查未完成。",
      };
    }

    await sleep(MIN_INTERVAL_MS);

    if (!resp.ok) {
      failedCount += 1;
      if (!firstError) firstError = resp.message ?? resp.code ?? "搜索失败";
      continue;
    }

    for (const r of resp.results ?? []) {
      if (byCanonical.has(r.canonicalUrl)) continue;
      byCanonical.set(r.canonicalUrl, r);
      collected.push(r);
    }
  }

  const snapshot: WatchSnapshot = {
    takenAt: new Date().toISOString(),
    queries: target.queries,
    freshness: WATCH_FRESHNESS,
    resultStatus: target.snapshots[target.snapshots.length - 1]?.resultStatus ?? null,
    sourceUrls: collected.map((s) => s.canonicalUrl),
    topSources: collected.slice(0, MAX_TOP_SOURCES).map(toSnapshotSource),
    searchCount: target.queries.length,
    failedCount,
    error: firstError,
  };

  const diff = await buildDiff({
    target,
    snapshot,
    collected,
    withAssessment,
  });

  // 结论被判定为已变化时才更新快照状态；否则沿用先前结论，不制造假的变化
  if (diff.statusChanged && diff.toStatus) {
    snapshot.resultStatus = diff.toStatus;
  }

  const next: WatchTarget = {
    ...target,
    lastCheckedAt: snapshot.takenAt,
    snapshots: [...target.snapshots, snapshot].slice(-20),
    lastDiff: diff,
  };

  return { target: next, diff };
}

async function buildDiff(args: {
  target: WatchTarget;
  snapshot: WatchSnapshot;
  collected: SearchResult[];
  withAssessment: boolean;
}): Promise<WatchDiff> {
  const { target, snapshot, collected } = args;
  const prev = target.snapshots[target.snapshots.length - 1] ?? null;
  const fromStatus = prev?.resultStatus ?? null;

  const prevUrlSet = new Set(prev?.sourceUrls ?? []);
  const newRaw = collected.filter((s) => !prevUrlSet.has(s.canonicalUrl));

  let assessment: WatchDiff["assessment"] = null;
  let toStatus = fromStatus;
  let statusChanged = false;

  if (args.withAssessment && newRaw.length > 0) {
    const res = await assessDeltaWithModel({
      originalClaim: target.claim,
      previousStatus: fromStatus ?? "insufficient_evidence",
      newSources: newRaw.slice(0, MAX_ASSESS_SOURCES).map((s) => ({
        title: s.title,
        url: s.url,
        siteName: s.siteName,
        snippet: s.snippet,
      })),
    });
    if (!isLlmFailure(res)) {
      assessment = { changed: res.changed, reason: res.reason };
      if (res.changed && res.suggestedStatus) {
        toStatus = res.suggestedStatus;
        statusChanged = res.suggestedStatus !== fromStatus;
      }
    }
  }

  return {
    checkedAt: snapshot.takenAt,
    newSources: newRaw.slice(0, MAX_TOP_SOURCES).map(toSnapshotSource),
    freshness: snapshot.freshness,
    fromStatus,
    toStatus,
    statusChanged,
    assessment,
    searchCount: snapshot.searchCount,
    failedCount: snapshot.failedCount,
    error: snapshot.error,
  };
}
