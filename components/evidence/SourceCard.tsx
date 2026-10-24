"use client";

/**
 * 证据卡片（§13.4）
 * 必须显示：标题、站点、日期、摘要、所属子命题、当前证据关系、原始链接。
 * 网址无效时禁用链接并说明原因（§13.4）。
 * 蒙版揭示（§15.2）：必须提供非动画查看方式 —— 「显示完整摘要」按钮。
 */

import { useState } from "react";
import {
  RELATION_LABEL,
  type EvidenceRelation,
  type Evidence,
  type SearchResult,
} from "@/types/prism";

const RELATION_COLOR: Record<EvidenceRelation, string> = {
  supports: "var(--prism-spectral-supports)",
  contradicts: "var(--prism-spectral-contradicts)",
  context: "var(--prism-spectral-context)",
  unverified: "var(--prism-spectral-unverified)",
};

export function isLikelyValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

interface Props {
  source: SearchResult;
  evidence?: Evidence | null;
  claimText?: string | null;
  onUserRelationChange?: (evidenceId: string, relation: EvidenceRelation) => void;
  draggable?: boolean;
}

export default function SourceCard({
  source,
  evidence,
  claimText,
  onUserRelationChange,
  draggable,
}: Props) {
  const [revealed, setRevealed] = useState(false);
  const valid = isLikelyValidUrl(source.url);
  const relation = evidence?.userRelation ?? evidence?.relation ?? "unverified";
  const isUserSet = evidence?.userRelation != null;

  return (
    <article
      draggable={draggable}
      data-evidence-id={evidence?.id}
      className="glass-panel flex h-full flex-col gap-3 p-4"
      style={{
        borderLeft: `2px solid ${isUserSet ? "var(--prism-ink)" : RELATION_COLOR[relation]}`,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="label-en shrink-0">{source.id}</div>
        <div className="flex items-center gap-2">
          <span
            className="label-en px-2 py-1"
            style={{
              color: RELATION_COLOR[relation],
              border: `1px solid ${RELATION_COLOR[relation]}55`,
            }}
          >
            {RELATION_LABEL[relation].en}
            {isUserSet ? " · 手动" : ""}
          </span>
        </div>
      </div>

      <h3 className="text-[15px] font-medium leading-snug">{source.title}</h3>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--prism-silver-dim)]">
        <span>{source.siteName ?? "站点未知"}</span>
        <span aria-hidden>·</span>
        <span>
          {source.publishedAt
            ? `来源标注日期 ${source.publishedAt}`
            : "来源未提供日期"}
        </span>
        {source.relevanceScore != null ? (
          <>
            <span aria-hidden>·</span>
            <span title="搜索服务返回的相关性分数，不代表事实正确率">
              相关性 {source.relevanceScore.toFixed(2)}
            </span>
          </>
        ) : null}
      </div>

      <p
        className={`text-[13.5px] leading-[1.75] text-[var(--prism-silver)] transition-all ${
          revealed ? "" : "max-h-[4.5rem] overflow-hidden"
        }`}
      >
        {source.snippet || "该来源未提供摘要，需打开原文查看。"}
      </p>

      <button
        type="button"
        onClick={() => setRevealed((v) => !v)}
        className="self-start text-[12px] text-[var(--prism-accent)] underline decoration-dotted underline-offset-4"
      >
        {revealed ? "收起摘要" : "显示完整摘要"}
      </button>

      {claimText ? (
        <p className="border-t border-[var(--prism-hairline)] pt-3 text-[12px] leading-relaxed text-[var(--prism-silver-dim)]">
          所属子命题：{claimText}
        </p>
      ) : null}

      {evidence?.verificationStatus === "pending" ? (
        <p className="text-[12px] leading-relaxed text-[var(--prism-silver-dim)]">
          系统未对该来源做语义判断。
        </p>
      ) : null}

      {evidence && onUserRelationChange ? (
        <label className="mt-auto flex flex-col gap-1 pt-1 text-[12px] text-[var(--prism-silver-dim)]">
          你的分类（与系统判断分开记录）
          <select
            value={evidence.userRelation ?? ""}
            onChange={(e) =>
              onUserRelationChange(
                evidence.id,
                (e.target.value || "unverified") as EvidenceRelation,
              )
            }
            className="w-full border border-[var(--prism-hairline)] bg-transparent px-2 py-1.5 text-[13px] text-[var(--prism-ink)] outline-none focus:border-[var(--prism-accent)]"
          >
            <option value="">未手动分类</option>
            {(
              Object.keys(RELATION_LABEL) as EvidenceRelation[]
            ).map((r) => (
              <option key={r} value={r}>
                {RELATION_LABEL[r].zh} / {RELATION_LABEL[r].en}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="mt-auto pt-2">
        {valid ? (
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer external"
            className="inline-flex items-center gap-2 break-all text-[12.5px] text-[var(--prism-accent)] underline decoration-dotted underline-offset-4"
          >
            打开原始来源 ↗
          </a>
        ) : (
          <span className="text-[12.5px] text-[#ff6b6b]">
            该来源网址无效，链接已禁用
          </span>
        )}
        <div className="mt-1 text-[11px] text-[var(--prism-silver-dim)]">
          检索于 {new Date(source.retrievedAt).toLocaleString("zh-CN")}
        </div>
      </div>
    </article>
  );
}
