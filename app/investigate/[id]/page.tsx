"use client";

/**
 * 调查工作台：命题解剖室（§4.1 B）→ 证据调查室（§4.1 C）→ 调查报告（§4.1 D）
 * 每一步的状态都由真实任务结果驱动，不使用定时动画冒充进度（§13.6）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  createPlan,
  executeInvestigation,
  MAX_ROUNDS_PER_CLAIM,
  MAX_TOTAL_SEARCHES,
  type PlannedBundle,
  type RunnerEvent,
} from "@/lib/investigation/runner";
import { RULE_MODE_NOTICE } from "@/lib/investigation/rules";
import { cacheBundle, saveBundle } from "@/lib/storage/local";
import SourceCard from "@/components/evidence/SourceCard";
import ReportView from "@/components/report/ReportView";
import Link from "next/link";
import PageNav from "@/components/nav/PageNav";
import AmbientBackdrop from "@/components/scene/AmbientBackdrop";
import {
  EVIDENCE_RELATIONS,
  RELATION_LABEL,
  type Evidence,
  type EvidenceRelation,
  type InvestigationBundle,
  type SearchRound,
  type SearchResult,
} from "@/types/prism";

type Stage = "loading" | "claims" | "running" | "done" | "failed";

interface DraftShape {
  claim: string;
  origin: "text" | "screenshot";
  imagePreview: string | null;
  ocrText?: string;
}

const PHASE_TEXT: Record<string, string> = {
  draft: "草稿",
  planning: "正在制定计划",
  searching: "正在执行真实搜索",
  verifying: "正在核验来源关系",
  synthesizing: "正在整理报告",
  completed: "已完成",
  partial: "部分完成",
  failed: "失败",
  cancelled: "已取消",
};

export default function InvestigatePage() {
  const params = useParams<{ id: string }>();
  const investigationId = params?.id ?? "";
  const router = useRouter();

  const [draft, setDraft] = useState<DraftShape | null>(null);
  const [stage, setStage] = useState<Stage>("loading");
  const [plan, setPlan] = useState<PlannedBundle | null>(null);
  const [claimDrafts, setClaimDrafts] = useState<{ text: string; purpose: string }[]>([]);
  const [planError, setPlanError] = useState<string | null>(null);

  const [rounds, setRounds] = useState<SearchRound[]>([]);
  const [sources, setSources] = useState<SearchResult[]>([]);
  const [bundle, setBundle] = useState<InvestigationBundle | null>(null);
  const [userRelations, setUserRelations] = useState<Record<string, EvidenceRelation>>({});
  const [log, setLog] = useState<{ message: string; tone?: string }[]>([]);
  const [phase, setPhase] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);

  /* ---------- 读取草稿 ---------- */
  useEffect(() => {
    if (!investigationId) return;
    const raw = sessionStorage.getItem(`prism:draft:${investigationId}`);
    if (!raw) {
      const cached = window.history.length > 1;
      if (cached) router.replace("/");
      return;
    }
    try {
      setDraft(JSON.parse(raw) as DraftShape);
    } catch {
      router.replace("/");
    }
  }, [investigationId, router]);

  /* ---------- 阶段 1-3：生成调查计划 ---------- */
  useEffect(() => {
    if (!draft || stage !== "loading") return;
    let alive = true;
    (async () => {
      const p = await createPlan(draft.claim);
      if (!alive) return;
      setPlan(p);
      setClaimDrafts(p.claims);
      setStage("claims");
    })();
    return () => {
      alive = false;
    };
  }, [draft, stage]);

  const updateClaimText = (i: number, text: string) => {
    setClaimDrafts((prev) => prev.map((c, idx) => (idx === i ? { ...c, text } : c)));
  };

  const removeClaim = (i: number) => {
    setClaimDrafts((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)));
  };

  const addClaim = () => {
    setClaimDrafts((prev) =>
      prev.length >= 5
        ? prev
        : [...prev, { text: "", purpose: "用户新增的子命题，请写明核验目标。" }],
    );
  };

  /* ---------- 阶段 4-8：执行真实搜索 ---------- */
  const startRun = useCallback(async () => {
    if (!draft || !plan) return;
    const trimmed = claimDrafts
      .map((c) => ({ ...c, text: c.text.trim() }))
      .filter((c) => c.text.length > 0);
    if (trimmed.length === 0) {
      setPlanError("至少需要保留一个非空的子命题。");
      return;
    }
    if (trimmed.some((c) => c.text.length > 200)) {
      setPlanError("单个子命题不得超过 200 字。");
      return;
    }
    setPlanError(null);

    // 用户修改过子命题后，重新按文本生成查询计划（§13.3）
    const finalPlan = new Map<
      number,
      { roundType: SearchRound["roundType"]; query: string; purpose: string }[]
    >();
    trimmed.forEach((c, i) => {
      const originalIndex = plan.claims.findIndex((x) => x.text === claimDrafts[i]?.text);
      const existing =
        originalIndex >= 0 ? plan.plan.get(originalIndex) : undefined;
      if (existing && existing.length > 0) finalPlan.set(i, existing);
    });

    setStage("running");
    setRounds([]);
    setSources([]);
    setLog([]);

    const controller = new AbortController();
    abortRef.current = controller;

    const onEvent = (e: RunnerEvent) => {
      switch (e.type) {
        case "phase":
          setPhase(PHASE_TEXT[e.status] ?? e.status);
          break;
        case "round_start":
          setRounds((prev) => [...prev.filter((r) => r.id !== e.round.id), e.round]);
          break;
        case "round_done":
          setRounds((prev) =>
            prev.map((r) => (r.id === e.round.id ? e.round : r)),
          );
          setSources((prev) => {
            const known = new Set(prev.map((s) => s.id));
            return [...prev, ...e.results.filter((s) => !known.has(s.id))];
          });
          break;
        case "round_error":
          setRounds((prev) => prev.map((r) => (r.id === e.round.id ? e.round : r)));
          setLog((prev) => [...prev, { message: `搜索失败：${e.message}`, tone: "warn" }]);
          break;
        case "log":
          setLog((prev) => [...prev, { message: e.message, tone: e.tone }]);
          break;
      }
    };

    try {
      const result = await executeInvestigation({
        investigationId,
        originalClaim: draft.claim,
        claimDrafts: trimmed,
        plan: finalPlan,
        mode: plan.mode,
        modelNotice: plan.modelNotice,
        origin: draft.origin,
        onEvent,
        signal: controller.signal,
      });
      // 用真实计划的实际结果覆盖（rounds/sources 已由事件流同步，这里统一以引擎返回为准）
      const merged: InvestigationBundle = {
        ...result,
        sources: result.sources,
      };
      setBundle(merged);
      setSources(merged.sources);
      setRounds(merged.rounds);
      saveBundle(merged);
      cacheBundle(merged);
      setStage("done");
    } catch (err) {
      setLog((prev) => [
        ...prev,
        {
          message: `调查执行中断：${err instanceof Error ? err.message : String(err)}`,
          tone: "warn",
        },
      ]);
      setStage("failed");
    } finally {
      abortRef.current = null;
    }
  }, [claimDrafts, draft, investigationId, plan]);

  const cancelRun = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const relationCount = useMemo(() => {
    const counter: Record<string, number> = {};
    (bundle?.evidence ?? []).forEach((e: Evidence) => {
      const key = e.userRelation ?? e.relation;
      counter[key] = (counter[key] ?? 0) + 1;
    });
    return counter;
  }, [bundle]);

  const effectiveBundle = useMemo<InvestigationBundle | null>(() => {
    if (!bundle) return null;
    if (Object.keys(userRelations).length === 0) return bundle;
    const evidence = bundle.evidence.map((e) =>
      userRelations[e.id] ? { ...e, userRelation: userRelations[e.id] } : e,
    );
    return { ...bundle, evidence };
  }, [bundle, userRelations]);

  useEffect(() => {
    if (effectiveBundle) {
      saveBundle(effectiveBundle);
      cacheBundle(effectiveBundle);
    }
  }, [effectiveBundle]);

  /* ---------- 渲染 ---------- */

  if (stage === "loading" || !draft) {
    return (
      <Shell>
        <p className="text-[14px] text-[var(--prism-silver)]">
          {draft ? "正在制定调查计划…" : "正在读取调查输入…"}
        </p>
      </Shell>
    );
  }

  if (stage === "done" && effectiveBundle?.report) {
    return (
      <Shell investigationId={investigationId}>
        <ReportView bundle={effectiveBundle} />
      </Shell>
    );
  }

  return (
    <Shell investigationId={investigationId} onCancel={stage === "running" ? cancelRun : undefined}>
      {/* 原始命题 */}
      <section className="glass-panel p-5">
        <div className="label-en">原始命题 / Original claim</div>
        <p className="mt-2 text-[17px] leading-relaxed">{draft.claim}</p>
        {draft.origin === "screenshot" ? (
          <p className="mt-3 text-[12px] text-[var(--prism-silver-dim)]">
            来源：截图 OCR 文本（已经用户确认后进入调查）
            {draft.imagePreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={draft.imagePreview}
                alt="用户上传的截图预览"
                className="mt-3 max-h-40 w-auto border border-[var(--prism-hairline)]"
              />
            ) : null}
          </p>
        ) : null}
        {plan?.modelNotice ? (
          <p className="mt-3 border-l-2 border-[var(--prism-spectral-unverified)] pl-3 text-[12.5px] leading-relaxed text-[var(--prism-silver)]">
            {plan.modelNotice}
          </p>
        ) : null}
      </section>

      {/* 命题解剖室 */}
      {stage === "claims" ? (
        <section className="mt-8">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="display-serif text-[22px]">命题解剖室</h2>
            <span className="label-en">
              每个子命题独立核验 · 最多 5 个
            </span>
          </div>

          <ul className="grid gap-3">
            {claimDrafts.map((c, i) => (
              <li key={i} className="glass-panel p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="label-en">C-{i + 1}</span>
                  <button
                    type="button"
                    onClick={() => removeClaim(i)}
                    disabled={claimDrafts.length <= 1}
                    className="text-[12px] text-[var(--prism-silver-dim)] transition-colors hover:text-[#ff6b6b] disabled:opacity-40"
                  >
                    删除
                  </button>
                </div>
                <textarea
                  value={c.text}
                  onChange={(e) => updateClaimText(i, e.target.value)}
                  rows={2}
                  maxLength={200}
                  className="w-full resize-none border-0 border-b border-[var(--prism-hairline)] bg-transparent pb-2 text-[15px] leading-relaxed outline-none focus:border-[var(--prism-accent)]"
                />
                <p className="mt-2 text-[12px] leading-relaxed text-[var(--prism-silver-dim)]">
                  {c.purpose}
                </p>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={addClaim}
              disabled={claimDrafts.length >= 5}
              className="border border-[var(--prism-hairline)] px-4 py-2.5 text-[12.5px] text-[var(--prism-silver)] transition-colors hover:border-[var(--prism-accent)] hover:text-[var(--prism-accent)] disabled:opacity-40"
            >
              + 新增子命题
            </button>
            <button
              type="button"
              onClick={startRun}
              className="border border-[var(--prism-accent)] bg-[var(--prism-accent)] px-6 py-2.5 text-[13px] uppercase tracking-[0.14em] text-[var(--prism-void)] transition-opacity hover:opacity-90"
            >
              确认范围并开始调查
            </button>
          </div>

          {planError ? (
            <p className="mt-3 text-[13px] text-[#ff6b6b]">{planError}</p>
          ) : null}

          <p className="mt-4 max-w-[70ch] text-[12px] leading-relaxed text-[var(--prism-silver-dim)]">
            搜索预算：每个子命题最多 {MAX_ROUNDS_PER_CLAIM} 轮计划内搜索，整次调查最多{" "}
            {MAX_TOTAL_SEARCHES} 次搜索。达到上限会自动停止并说明原因。修改后的子命题将重新生成查询计划，旧的调查结果不会沿用。
          </p>
          {plan?.mode === "rule" ? (
            <p className="mt-2 max-w-[70ch] text-[12px] leading-relaxed text-[var(--prism-spectral-unverified)]">
              {RULE_MODE_NOTICE}
            </p>
          ) : null}
        </section>
      ) : null}

      {/* 证据调查室 */}
      {stage === "running" || stage === "failed" ? (
        <section className="mt-8">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="display-serif text-[22px]">证据调查室</h2>
            <span className="label-en">{phase || "正在调查"}</span>
          </div>

          <div className="grid gap-3">
            {rounds.length === 0 ? (
              <p className="text-[13.5px] text-[var(--prism-silver)]">
                正在向服务端发起第一次真实搜索…
              </p>
            ) : null}
            {rounds.map((r) => (
              <div key={r.id} className="glass-panel p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="label-en">
                    {r.roundType} · {r.id}
                  </span>
                  <RoundBadge status={r.status} />
                </div>
                <p className="mt-2 break-all text-[14px]">
                  查询词：<span className="text-[var(--prism-accent)]">{r.query}</span>
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-[var(--prism-silver-dim)]">
                  {r.purpose}
                </p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--prism-silver-dim)]">
                  <span>返回 {r.resultCount} 条去重后来源</span>
                  {r.startedAt ? (
                    <span>开始 {new Date(r.startedAt).toLocaleTimeString("zh-CN")}</span>
                  ) : null}
                  {r.completedAt ? (
                    <span>完成 {new Date(r.completedAt).toLocaleTimeString("zh-CN")}</span>
                  ) : null}
                </div>
                {r.errorMessage ? (
                  <p className="mt-2 text-[12.5px] text-[#ff6b6b]">
                    错误：{r.errorMessage}（错误码 {r.errorCode}）
                  </p>
                ) : null}
              </div>
            ))}
          </div>

          {log.length > 0 ? (
            <ul className="mt-4 grid gap-2">
              {log.map((l, i) => (
                <li
                  key={i}
                  className={`border-l-2 pl-3 text-[12.5px] leading-relaxed ${
                    l.tone === "warn"
                      ? "border-[#ff6b6b] text-[var(--prism-silver)]"
                      : "border-[var(--prism-hairline)] text-[var(--prism-silver-dim)]"
                  }`}
                >
                  {l.message}
                </li>
              ))}
            </ul>
          ) : null}

          {sources.length > 0 ? (
            <div className="mt-8">
              <div className="label-en mb-3">已获取来源 / {sources.length}</div>
              <div className="prism-evidence-flow mt-3 columns-1 md:columns-2 xl:columns-3">
                {sources.map((s, i) => (
                  <SourceCard
                    key={s.id}
                    source={s}
                    index={i}
                    claimText={
                      effectiveBundle?.claims.find(
                        (c) => c.id === rounds.find((r) => r.id === s.roundId)?.claimId,
                      )?.text ?? null
                    }
                  />
                ))}
              </div>
            </div>
          ) : null}

          {stage === "failed" ? (
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setStage("claims")}
                className="border border-[var(--prism-hairline-strong)] px-5 py-2.5 text-[13px]"
              >
                返回命题编辑
              </button>
              <button
                type="button"
                onClick={startRun}
                className="border border-[var(--prism-accent)] bg-[var(--prism-accent)] px-5 py-2.5 text-[13px] text-[var(--prism-void)]"
              >
                重新执行调查
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* 拖拽分类区（§15.4）：仅在调查结束后可用 */}
      {stage === "done" && effectiveBundle ? (
        <EvidenceClassification
          bundle={effectiveBundle}
          userRelations={userRelations}
          onChange={(id, rel) =>
            setUserRelations((prev) => ({ ...prev, [id]: rel }))
          }
          counts={relationCount}
        />
      ) : null}
    </Shell>
  );
}

function RoundBadge({ status }: { status: SearchRound["status"] }) {
  const map: Record<string, { text: string; color: string }> = {
    pending: { text: "等待", color: "var(--prism-silver-dim)" },
    running: { text: "执行中", color: "var(--prism-accent)" },
    succeeded: { text: "完成", color: "var(--prism-spectral-supports)" },
    empty: { text: "无结果", color: "var(--prism-spectral-unverified)" },
    failed: { text: "失败", color: "var(--prism-spectral-contradicts)" },
  };
  const v = map[status] ?? map.pending;
  return (
    <span className="label-en" style={{ color: v.color }}>
      {v.text}
    </span>
  );
}

function EvidenceClassification({
  bundle,
  userRelations,
  onChange,
  counts,
}: {
  bundle: InvestigationBundle;
  userRelations: Record<string, EvidenceRelation>;
  onChange: (evidenceId: string, relation: EvidenceRelation) => void;
  counts: Record<string, number>;
}) {
  const evidenceById = new Map(bundle.evidence.map((e) => [e.sourceId, e]));

  const onDrop = (rel: EvidenceRelation) => (e: React.DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    if (!id) return;
    onChange(id, rel);
  };

  return (
    <section className="mt-10">
      <h2 className="display-serif text-[22px]">证据分类</h2>
      <p className="mt-2 max-w-[70ch] text-[12.5px] leading-relaxed text-[var(--prism-silver-dim)]">
        把卡片拖到下方任一区域即可完成手动分类；无法拖拽时请使用卡片内的下拉菜单。你的分类与系统判断分开记录，不会改动搜索结果或原始证据本身（§12.5）。
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        {EVIDENCE_RELATIONS.map((rel) => (
          <div
            key={rel}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop(rel)}
            className="glass-panel flex items-center justify-between px-4 py-4"
          >
            <span className="label-en">{RELATION_LABEL[rel].en}</span>
            <span className="text-[13px]">{counts[rel] ?? 0}</span>
          </div>
        ))}
      </div>

      <div className="prism-evidence-flow mt-5 columns-1 md:columns-2 xl:columns-3">
        {bundle.sources.map((s, i) => {
          const ev = evidenceById.get(s.id) ?? null;
          return (
            <SourceCard
              key={s.id}
              source={s}
              index={i}
              evidence={
                ev
                  ? {
                      ...ev,
                      userRelation: userRelations[ev.id] ?? ev.userRelation,
                    }
                  : null
              }
              claimText={
                bundle.claims.find(
                  (c) => c.id === bundle.rounds.find((r) => r.id === s.roundId)?.claimId,
                )?.text ?? null
              }
              onUserRelationChange={onChange}
              draggable={Boolean(ev)}
            />
          );
        })}
      </div>
    </section>
  );
}

function Shell({
  children,
  investigationId,
  onCancel,
}: {
  children: React.ReactNode;
  investigationId?: string;
  onCancel?: () => void;
}) {
  return (
    <main className="relative min-h-dvh">
      <AmbientBackdrop />
      <div className="mx-auto w-full max-w-[1120px] px-6 py-8 md:px-8">
        <header className="mb-8 flex flex-wrap items-center gap-x-6 gap-y-3">
          <PageNav />
          <Link href="/" className="flex items-baseline gap-3">
            <span className="display-serif text-[20px] tracking-[0.18em]">PRISM</span>
            <span className="label-en">Evidence Observatory</span>
          </Link>
          <div className="ml-auto flex items-center gap-4 text-[12.5px]">
            {investigationId ? (
              <span className="label-en">{investigationId}</span>
            ) : null}
            {onCancel ? (
              <button
                type="button"
                onClick={onCancel}
                className="border border-[var(--prism-hairline)] px-3 py-1.5 text-[var(--prism-silver)] hover:border-[#ff6b6b] hover:text-[#ff6b6b]"
              >
                暂停调查
              </button>
            ) : null}
          </div>
        </header>
        {children}
      </div>
    </main>
  );
}
