"use client";

/**
 * 双语透镜（§15.3）
 * 事件委托：容器内所有带 data-lens-en / data-lens-zh 的元素都会触发透镜。
 * 透镜固定不遮挡按钮；移动端与 reduced-motion 下自动关闭（术语本身始终显示）。
 */

import { useCallback, useEffect, useRef, useState } from "react";

interface LensState {
  x: number;
  y: number;
  en: string;
  zh: string;
}

export function LensTerm({
  en,
  zh,
  children,
}: {
  en: string;
  zh: string;
  children?: React.ReactNode;
}) {
  return (
    <span data-lens-en={en} data-lens-zh={zh} className="cursor-help">
      {children ?? zh}
    </span>
  );
}

export default function BilingualLens({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const [state, setState] = useState<LensState | null>(null);
  const [enabled, setEnabled] = useState(false);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    setEnabled(!reduce && fine);
  }, []);

  const onMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!enabled) return;
      const target = e.target as HTMLElement | null;
      const holder = target?.closest?.("[data-lens-en]") as HTMLElement | null;
      if (!holder) {
        setState(null);
        return;
      }
      const en = holder.getAttribute("data-lens-en") ?? "";
      const zh = holder.getAttribute("data-lens-zh") ?? "";
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        setState({ x: e.clientX, y: e.clientY, en, zh });
        frame.current = null;
      });
    },
    [enabled],
  );

  useEffect(() => {
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, []);

  return (
    <div className={className} onPointerMove={onMove} onPointerLeave={() => setState(null)}>
      {children}
      {enabled && state ? (
        <div
          aria-hidden
          className="pointer-events-none fixed z-40 -translate-x-1/2 -translate-y-[130%] rounded-[2px] border border-[var(--prism-hairline-strong)] bg-[rgba(9,11,16,0.92)] px-2.5 py-1.5 backdrop-blur-md"
          style={{ left: state.x, top: state.y }}
        >
          <div className="label-en leading-none">{state.en}</div>
          <div className="mt-1 text-[13px] leading-none text-[var(--prism-ink)]">
            {state.zh}
          </div>
        </div>
      ) : null}
    </div>
  );
}
