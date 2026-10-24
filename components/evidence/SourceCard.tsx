"use client";

/**
 * 证据悬浮卡片（§13.4）
 *
 * 设计约束：
 *  - 卡片本身即证据链接：整卡可点开原始来源，不再单独提供一行链接。
 *    带交互控件（手动分类 / 拖拽）时改用整卡点击 + 控件拦截，避免 <a> 嵌套。
 *  - 重点内容突出：证据关系徽章 + 标题 + 相关性分数一眼可读。
 *  - 网址无效时禁用打开并说明原因（§13.4），不得假装能点。
 *  - 摘要蒙版揭示（§15.2）保留「显示完整摘要」的非动画查看方式。
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
  /** 同一区块内的序号，用于错落编排（倾角与位移） */
  index?: number;
}

/** 确定性伪随机：让卡片错落但不闪烁（SSR / CSR 一致） */
export function drift(index: number): { rotate: number; shiftY: number } {
  const rotate = (((index * 37) % 9) - 4) * 0.35;
  const shiftY = ((index * 53) % 7) * 2.5;
  return { rotate, shiftY };
}

export default function SourceCard({
  source,
  evidence,
  claimText,
  onUserRelationChange,
  draggable,
  index = 0,
}: Props) {
  const [revealed, setRevealed] = useState(false);
  const valid = isLikelyValidUrl(source.url);
  const relation = evidence?.userRelation ?? evidence?.relation ?? "unverified";
  const isUserSet = evidence?.userRelation != null;
  const interactive = !!onUserRelationChange || !!draggable;
  const d = drift(index);

  const openSource = () => {
    if (valid) window.open(source.url, "_blank", "noopener,noreferrer");
  };

  const stop = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };

  const inner = (
    <>
      {/* 角标装饰：科技感的取景框 */}
      <span className="prism-ecard-corner tl" aria-hidden="true" />
      <span className="prism-ecard-corner br" aria-hidden="true" />

      <div className="flex items-start justify-between gap-3">
        <span
          className="prism-ecard-badge"
          style={{
            color: RELATION_COLOR[relation],
            borderColor: `${RELATION_COLOR[relation]}66`,
            background: `${RELATION_COLOR[relation]}0f`,
          }}
        >
          <span
            className="prism-ecard-dot"
            style={{ background: RELATION_COLOR[relation] }}
            aria-hidden="true"
          />
          {RELATION_LABEL[relation].zh}
          {isUserSet ? " · 手动" : ""}
        </span>

        {source.relevanceScore != null ? (
          <span
            className="shrink-0 font-mono text-[11.5px] text-[var(--prism-silver-dim)]"
            title="搜索服务返回的相关性分数，不代表事实正确率"
          >
            相关性{" "}
            <span className="text-[var(--prism-ink)]">
              {source.relevanceScore.toFixed(2)}
            </span>
          </span>
        ) : null}
      </div>

      <h3 className="prism-ecard-title">{source.title}</h3>

      <p
        className={`text-[13px] leading-[1.75] text-[var(--prism-silver)] transition-all duration-300 ${
          revealed ? "" : "prism-ecard-clamp"
        }`}
      >
        {source.snippet || "该来源未提供摘要，需打开原文查看。"}
      </p>

      <button
        type="button"
        onClick={(e) => {
          stop(e);
          setRevealed((v) => !v);
        }}
        className="self-start text-[12px] text-[var(--prism-accent)] underline decoration-dotted underline-offset-4"
      >
        {revealed ? "收起摘要" : "显示完整摘要"}
      </button>

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--prism-hairline)] pt-3 text-[11.5px] text-[var(--prism-silver-dim)]">
        <span className="text-[var(--prism-silver)]">
          {source.siteName ?? "站点未知"}
        </span>
        <span aria-hidden>·</span>
        <span>
          {source.publishedAt ? source.publishedAt : "日期未标注"}
        </span>
        <span aria-hidden>·</span>
        <span>检索于 {new Date(source.retrievedAt).toLocaleString("zh-CN")}</span>
        {claimText ? (
          <span className="basis-full truncate">属命题：{claimText}</span>
        ) : null}
      </div>

      {evidence?.verificationStatus === "pending" ? (
        <p className="text-[11.5px] leading-relaxed text-[var(--prism-silver-dim)]">
          系统未对该来源做语义判断。
        </p>
      ) : null}

      {evidence && onUserRelationChange ? (
        <label
          className="flex flex-col gap-1 text-[12px] text-[var(--prism-silver-dim)]"
          onClick={stop}
        >
          你的分类（与系统判断分开记录）
          <select
            value={evidence.userRelation ?? ""}
            onChange={(e) =>
              onUserRelationChange(
                evidence.id,
                (e.target.value || "unverified") as EvidenceRelation,
              )
            }
            className="w-full cursor-pointer border border-[var(--prism-hairline)] bg-transparent px-2 py-1.5 text-[13px] text-[var(--prism-ink)] outline-none focus:border-[var(--prism-accent)]"
          >
            <option value="">未手动分类</option>
            {(Object.keys(RELATION_LABEL) as EvidenceRelation[]).map((r) => (
              <option key={r} value={r}>
                {RELATION_LABEL[r].zh} / {RELATION_LABEL[r].en}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {!valid ? (
        <p className="text-[12.5px] text-[#ff6b6b]">
          该来源网址无效，打开已禁用
        </p>
      ) : null}
    </>
  );

  const cls = `prism-ecard${valid ? " prism-ecard-openable" : ""}`;
  const driftStyle = {
    borderLeft: `2px solid ${RELATION_COLOR[relation]}`,
    "--prism-rot": `${d.rotate}deg`,
    "--prism-dy": `${d.shiftY}px`,
  } as React.CSSProperties;

  if (valid && !interactive) {
    return (
      <a
        href={source.url}
        target="_blank"
        rel="noopener noreferrer external"
        data-evidence-id={evidence?.id}
        className={cls}
        style={driftStyle}
      >
        {inner}
      </a>
    );
  }

  return (
    <article
      draggable={draggable}
      data-evidence-id={evidence?.id}
      className={cls}
      style={{
        ...driftStyle,
        cursor: valid ? "pointer" : "default",
      }}
      onClick={valid ? openSource : undefined}
      onKeyDown={
        valid
          ? (e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) openSource();
            }
          : undefined
      }
      tabIndex={valid ? 0 : undefined}
      role={valid ? "link" : undefined}
      aria-label={valid ? `打开来源：${source.title}` : undefined}
    >
      {inner}
    </article>
  );
}
