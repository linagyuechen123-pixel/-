"use client";

/**
 * 调查报告页（§4.1 D / §8.5）
 * 必须包含：标题、原始命题、调查范围、核心结论、结论状态、子命题结论、
 * 支持/反对/背景证据、来源列表、来源关系说明、矛盾点、调查局限、
 * 尚未解决的问题、后续核验建议、调查执行记录。
 */

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import SourceCard from "@/components/evidence/SourceCard";
import Link from "next/link";
import { createWatchTarget } from "@/lib/investigation/watch";
import { isWatched, saveTarget } from "@/lib/storage/watch";
import {
  RESULT_STATUS_LABEL,
  type Evidence,
  type EvidenceRelation,
  type InvestigationBundle,
  type SearchResult,
} from "@/types/prism";

const EvidenceNetwork = dynamic(
  () => import("@/components/scene/EvidenceNetwork"),
  { ssr: false },
);

export default function ReportView({ bundle }: { bundle: InvestigationBundle }) {
  const { report, evidence, sources, rounds, claims, investigation } = bundle;
  const [showRounds, setShowRounds] = useState(false);
  const [watched, setWatched] = useState(false);

  useEffect(() => {
    setWatched(isWatched(investigation.id));
  }, [investigation.id]);

  if (!report) {
    return (
      <section className="glass-panel p-6">
        <h2 className="display-serif text-[20px]">尚未生成报告</h2>
        <p className="mt-3 text-[13.5px] leading-relaxed text-[var(--prism-silver)]">
          本次调查未生成报告，可能是因为调查未完成或执行被中断。调查状态：
          {investigation.status}
          {investigation.errorMessage ? ` · ${investigation.errorMessage}` : ""}
        </p>
      </section>
    );
  }

  const byId = new Map<string, SearchResult>(sources.map((s) => [s.id, s]));
  const evidenceById = new Map<string, Evidence>(evidence.map((e) => [e.sourceId, e]));
  const status = RESULT_STATUS_LABEL[report.resultStatus];

  // 证据关系网络的节点：主干 = 原命题，分枝 = 子命题，叶片 = 真实来源
  // 直接计算而非 useMemo：这段在 report 判空之后，条件调用 Hook 会违反 Hook 规则
  const claimIndex = new Map<string, number>();
  claims.forEach((c, i) => claimIndex.set(c.id, i));
  const orderCount = new Map<string, number>();
  const networkNodes = evidence.map((e) => {
    const key = e.claimId ?? "root";
    const order = orderCount.get(key) ?? 0;
    orderCount.set(key, order + 1);
    return {
      id: e.id,
      claimId: e.claimId,
      relation: (e.userRelation ?? e.relation) as EvidenceRelation,
      branchIndex: claimIndex.get(e.claimId ?? "") ?? 0,
      order,
    };
  });

  const renderGroup = (title: string, rel: EvidenceRelation, empty: string) => {
    const items = evidence.filter((e) => (e.userRelation ?? e.relation) === rel);
    return (
      <section className="mt-8">
        <h3 className="label-en">{title}</h3>
        {items.length === 0 ? (
          <p className="mt-3 text-[13px] leading-relaxed text-[var(--prism-silver-dim)]">
            {empty}
          </p>
        ) : (
          <div className="prism-evidence-flow mt-3 columns-1 md:columns-2 xl:columns-3">
            {items.map((e, i) => {
              const s = byId.get(e.sourceId);
              if (!s) return null;
              return (
                <SourceCard
                  key={e.id}
                  source={s}
                  evidence={e}
                  index={i}
                  claimText={claims.find((c) => c.id === e.claimId)?.text ?? null}
                />
              );
            })}
          </div>
        )}
      </section>
    );
  };

  return (
    <article>
      {/* 未完成提示 */}
      {report.incomplete ? (
        <div className="mb-6 border-l-2 border-[#ff6b6b] bg-[rgba(255,107,107,0.06)] px-4 py-3">
          <p className="text-[13px] leading-relaxed text-[var(--prism-ink)]">
            注意：本次调查未完整执行完成，本报告不构成完整调查结论，请查看下方「调查局限」与「调查执行记录」。
          </p>
        </div>
      ) : null}

      {report.mode === "rule" ? (
        <div className="mb-6 border-l-2 border-[var(--prism-spectral-unverified)] pl-4">
          <p className="text-[13px] leading-relaxed text-[var(--prism-silver)]">
            本报告由规则化降级模式生成：命题拆分与查询计划来自固定规则模板，系统未执行大模型语义推理，证据关系全部标记为「待核验」。
          </p>
        </div>
      ) : null}

      <div className="label-en">Report / 调查报告</div>
      <h1 className="display-serif mt-3 text-[clamp(1.6rem,4vw,2.6rem)] leading-tight">
        {report.title}
      </h1>

      <div className="mt-6 grid gap-6 md:grid-cols-[1.6fr_1fr]">
        <div className="glass-panel p-5">
          <div className="label-en">原始命题</div>
          <p className="mt-2 text-[15.5px] leading-relaxed">{report.originalClaim}</p>
          <div className="mt-4 border-t border-[var(--prism-hairline)] pt-4">
            <div className="label-en">调查范围</div>
            <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--prism-silver)]">
              {report.scope}
            </p>
          </div>
        </div>

        <div className="glass-panel p-5">
          <div className="label-en">结论状态</div>
          <p className="mt-2 text-[20px]" style={{ color: statusColor(report.resultStatus) }}>
            {status.zh}
          </p>
          <p className="label-en mt-1">{status.en}</p>
          <p className="mt-3 text-[12.5px] leading-relaxed text-[var(--prism-silver-dim)]">
            {status.note}
          </p>
        </div>
      </div>

      <section className="mt-8">
        <h2 className="label-en">核心结论</h2>
        <p className="mt-3 max-w-[76ch] text-[15px] leading-[1.85]">{report.summary}</p>
      </section>

      <section className="mt-8">
        <h2 className="label-en">子命题结论</h2>
        <ul className="mt-3 grid gap-3">
          {report.claimFindings.map((f) => (
            <li key={f.claimId} className="glass-panel p-4">
              <p className="text-[14.5px] leading-relaxed">{f.claimText}</p>
              <p
                className="mt-2 text-[12.5px]"
                style={{ color: statusColor(f.resultStatus) }}
              >
                {RESULT_STATUS_LABEL[f.resultStatus].zh} ·{" "}
                {RESULT_STATUS_LABEL[f.resultStatus].en}
              </p>
              <p className="mt-2 text-[13px] leading-relaxed text-[var(--prism-silver)]">
                {f.summary}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {networkNodes.length > 0 ? (
        <section className="mt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="label-en">证据关系网络 / Evidence Network</h2>
            <span className="text-[11.5px] text-[var(--prism-silver-dim)]">
              按住左键左右拖动可转动视角
            </span>
          </div>
          <div className="relative mt-3 overflow-hidden border border-[var(--prism-hairline)] bg-[rgba(6,8,12,0.5)]">
            <EvidenceNetwork
              nodes={networkNodes}
              className="h-[360px] w-full md:h-[460px]"
            />
            <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-3 text-[11px] text-[var(--prism-silver-dim)]">
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-2 rotate-45"
                  style={{ background: "var(--prism-spectral-supports)" }}
                />
                支持
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-2 rotate-45"
                  style={{ background: "var(--prism-spectral-contradicts)" }}
                />
                反对
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-2 rotate-45"
                  style={{ background: "var(--prism-spectral-context)" }}
                />
                背景
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-2 rotate-45"
                  style={{ background: "var(--prism-spectral-unverified)" }}
                />
                待核验
              </span>
            </div>
            <p className="pointer-events-none absolute bottom-3 left-3 right-3 text-[11px] leading-relaxed text-[var(--prism-silver-dim)]">
              主干为原始命题，分枝为拆解出的子命题，每一枚叶片是一组同向证据（叶片越大表示该组证据越多）；红色连线表示同一子命题下「支持」与「反对」之间存在冲突。
            </p>
          </div>
        </section>
      ) : null}

      {renderGroup(
        "支持证据 / Supports",
        "supports",
        "本次未检索到明确支持该命题的来源。这不代表命题为假。",
      )}
      {renderGroup(
        "反对证据 / Contradicts",
        "contradicts",
        "本次未检索到与该命题冲突的来源。这不代表命题已被证实。",
      )}
      {renderGroup(
        "背景信息 / Context",
        "context",
        "本次未检索到仅提供背景信息的来源。",
      )}
      {renderGroup(
        "待核验 / Unverified",
        "unverified",
        "没有需要人工核验的来源。",
      )}

      <section className="mt-8">
        <h2 className="label-en">矛盾点 / Contradictions</h2>
        {report.contradictions.length === 0 ? (
          <p className="mt-3 text-[13px] text-[var(--prism-silver-dim)]">
            本次检索未发现明确的证据冲突。
          </p>
        ) : (
          <ul className="mt-3 grid gap-2">
            {report.contradictions.map((c, i) => (
              <li
                key={i}
                className="border-l-2 border-[var(--prism-spectral-contradicts)] pl-3 text-[13.5px] leading-relaxed"
              >
                {c}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="label-en">来源清单 / Sources · {sources.length}</h2>
        {sources.length === 0 ? (
          <p className="mt-3 text-[13px] text-[var(--prism-silver-dim)]">
            本次没有检索到来源。
          </p>
        ) : (
          <ul className="mt-3 grid grid-cols-1 gap-1.5">
            {sources.map((s) => {
              const e = evidenceById.get(s.id);
              return (
                <li
                  key={s.id}
                  className="flex min-w-0 flex-col gap-1 border-l border-[var(--prism-hairline)] pl-3 text-[12.5px] text-[var(--prism-silver-dim)] sm:flex-row sm:items-center sm:gap-3"
                >
                  <span className="min-w-0 flex-1 truncate text-[var(--prism-silver)]">
                    {s.title}
                  </span>
                  <span className="shrink-0">
                    {s.siteName ?? "站点未知"} ·{" "}
                    {s.publishedAt ? s.publishedAt : "日期未知"}
                  </span>
                  <span className="label-en shrink-0">
                    {e ? (e.userRelation ?? e.relation) : "无证据记录"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-[12.5px] leading-relaxed text-[var(--prism-silver-dim)]">
          {report.sourceRelationsNote}
        </p>
      </section>

      <section className="mt-8">
        <h2 className="label-en">调查局限 / Limitations</h2>
        <ul className="mt-3 grid gap-2">
          {report.limitations.map((l, i) => (
            <li
              key={i}
              className="border-l-2 border-[var(--prism-hairline)] pl-3 text-[13px] leading-relaxed text-[var(--prism-silver)]"
            >
              {l}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="label-en">尚未解决的问题</h2>
        {report.unresolvedQuestions.length === 0 ? (
          <p className="mt-3 text-[13px] text-[var(--prism-silver-dim)]">
            未记录到待解决问题。
          </p>
        ) : (
          <ul className="mt-3 grid gap-2">
            {report.unresolvedQuestions.map((q, i) => (
              <li key={i} className="text-[13.5px] leading-relaxed">
                · {q}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="label-en">后续核验建议</h2>
        <ol className="mt-3 grid gap-2">
          {report.nextSteps.map((n, i) => (
            <li key={i} className="text-[13.5px] leading-relaxed">
              {i + 1}. {n}
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-8">
        <button
          type="button"
          onClick={() => setShowRounds((v) => !v)}
          className="label-en underline decoration-dotted underline-offset-4"
        >
          调查执行记录 / {rounds.length} 轮真实搜索 · {investigation.searchCount} 次调用{" "}
          {showRounds ? "（收起）" : "（展开）"}
        </button>
        {showRounds ? (
          <ul className="mt-3 grid gap-2">
            {rounds.map((r) => (
              <li key={r.id} className="glass-panel p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="label-en">
                    {r.roundType} · {r.id}
                  </span>
                  <span className="label-en">{r.status}</span>
                </div>
                <p className="mt-2 text-[13.5px] break-all">
                  查询词：{r.query}
                </p>
                <p className="mt-1 text-[12px] text-[var(--prism-silver-dim)]">
                  {r.purpose}
                </p>
                <div className="mt-2 flex flex-wrap gap-x-4 text-[12px] text-[var(--prism-silver-dim)]">
                  <span>结果 {r.resultCount} 条</span>
                  <span>开始 {formatTime(r.startedAt)}</span>
                  <span>完成 {r.completedAt ? formatTime(r.completedAt) : "未完成"}</span>
                  {r.errorCode ? <span>错误码 {r.errorCode}</span> : null}
                </div>
                {r.errorMessage ? (
                  <p className="mt-2 text-[12.5px] text-[#ff6b6b]">{r.errorMessage}</p>
                ) : null}
                {r.openQuestions.length > 0 ? (
                  <ul className="mt-2 grid gap-1">
                    {r.openQuestions.map((q, i) => (
                      <li key={i} className="text-[12.5px] text-[var(--prism-silver-dim)]">
                        · {q}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="mt-8 glass-panel p-5">
        <h2 className="label-en">持续盯梢 / Keep watching</h2>
        <p className="mt-3 max-w-[72ch] text-[13.5px] leading-relaxed text-[var(--prism-silver)]">
          把这个说法加入盯梢列表，监控中心会按设定的间隔重新执行本次调查用过的查询词，
          比对新出现的来源。每次复查都是真实搜索；自动复查只在本站页面保持打开时触发，
          因为部署环境没有服务端定时任务。
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {watched ? (
            <>
              <span
                className="label-en border px-4 py-2"
                style={{
                  color: "var(--prism-accent)",
                  borderColor: "var(--prism-accent)66",
                }}
              >
                已在盯梢列表
              </span>
              <Link
                href="/monitor"
                className="border border-[var(--prism-hairline-strong)] px-5 py-2.5 text-[13px] hover:border-[var(--prism-accent)] hover:text-[var(--prism-accent)]"
              >
                去监控中心
              </Link>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                const target = createWatchTarget({
                  investigationId: investigation.id,
                  claim: investigation.originalClaim,
                  rounds,
                  sources,
                  resultStatus: report.resultStatus ?? null,
                });
                saveTarget(target);
                setWatched(true);
              }}
              className="border border-[var(--prism-hairline-strong)] px-5 py-2.5 text-[13px] hover:border-[var(--prism-accent)] hover:text-[var(--prism-accent)]"
            >
              盯住这个说法
            </button>
          )}
        </div>
      </section>

      <footer className="mt-10 flex flex-wrap gap-3 border-t border-[var(--prism-hairline)] pt-6">
        <Link
          href="/"
          className="border border-[var(--prism-hairline-strong)] px-5 py-2.5 text-[13px] hover:border-[var(--prism-accent)] hover:text-[var(--prism-accent)]"
        >
          返回首页
        </Link>
        <span className="self-center text-[12px] text-[var(--prism-silver-dim)]">
          生成于 {formatTime(report.generatedAt)} · 记录仅保存在当前浏览器本地存储
        </span>
      </footer>
    </article>
  );
}

function statusColor(s: string): string {
  switch (s) {
    case "supported":
      return "var(--prism-spectral-supports)";
    case "partially_supported":
      return "var(--prism-accent)";
    case "conflicting":
      return "var(--prism-spectral-contradicts)";
    default:
      return "var(--prism-spectral-unverified)";
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("zh-CN");
  } catch {
    return iso;
  }
}
