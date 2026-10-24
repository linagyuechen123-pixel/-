"use client";

/**
 * 调查报告页（§4.1 D / §8.5）
 * 必须包含：标题、原始命题、调查范围、核心结论、结论状态、子命题结论、
 * 支持/反对/背景证据、来源列表、来源关系说明、矛盾点、调查局限、
 * 尚未解决的问题、后续核验建议、调查执行记录。
 */

import { useState } from "react";
import SourceCard from "@/components/evidence/SourceCard";
import Link from "next/link";
import {
  RESULT_STATUS_LABEL,
  type Evidence,
  type EvidenceRelation,
  type InvestigationBundle,
  type SearchResult,
} from "@/types/prism";

export default function ReportView({ bundle }: { bundle: InvestigationBundle }) {
  const { report, evidence, sources, rounds, claims, investigation } = bundle;
  const [showRounds, setShowRounds] = useState(false);

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
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {items.map((e) => {
              const s = byId.get(e.sourceId);
              if (!s) return null;
              return (
                <SourceCard
                  key={e.id}
                  source={s}
                  evidence={e}
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
        <h2 className="label-en">来源列表 / Sources · {sources.length}</h2>
        <ul className="mt-3 grid gap-2">
          {sources.map((s) => {
            const e = evidenceById.get(s.id);
            return (
              <li
                key={s.id}
                className="glass-panel flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="min-w-0 flex-1">
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer external"
                    className="text-[13.5px] underline decoration-dotted underline-offset-4 hover:text-[var(--prism-accent)]"
                  >
                    {s.title}
                  </a>
                  <span className="ml-2 text-[12px] text-[var(--prism-silver-dim)]">
                    {s.siteName ?? "站点未知"} ·{" "}
                    {s.publishedAt ? s.publishedAt : "日期未知"}
                  </span>
                </span>
                <span className="label-en shrink-0">
                  {e ? (e.userRelation ?? e.relation) : "无证据记录"}
                </span>
              </li>
            );
          })}
        </ul>
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
