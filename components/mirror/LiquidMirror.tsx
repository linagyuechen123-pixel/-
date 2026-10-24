"use client";

/**
 * 液态黑镜（§15.1 鼠标驱动的流体扰动）
 * 实现：局部 CSS 自定义变量 + 单次 requestAnimationFrame 写入，不做全页重绘。
 * 移动端无指针悬停 → 自动降级；prefers-reduced-motion 下关闭。
 */

import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  children: React.ReactNode;
  className?: string;
  /** 提交时的收缩动效 */
  collapsed?: boolean;
}

export default function LiquidMirror({ children, className, collapsed }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef<number | null>(null);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    setEnabled(!reduce && fine);
  }, []);

  const apply = useCallback((x: number, y: number, intensity: number) => {
    const el = ref.current;
    if (!el) return;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      el.style.setProperty("--mirror-x", `${x}%`);
      el.style.setProperty("--mirror-y", `${y}%`);
      el.style.setProperty("--mirror-intensity", String(intensity));
      frame.current = null;
    });
  }, []);

  const onMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!enabled) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      apply(x, y, 1);
    },
    [apply, enabled],
  );

  const onLeave = useCallback(() => {
    if (!enabled) return;
    apply(50, 50, 0);
  }, [apply, enabled]);

  useEffect(() => {
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, []);

  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      className={`mirror-field ${className ?? ""}`}
      style={{
        transform: collapsed ? "scale(0.96)" : "scale(1)",
        opacity: collapsed ? 0.35 : 1,
        transition: "transform var(--dur-slow) var(--ease-prism), opacity var(--dur-slow) var(--ease-prism)",
      }}
    >
      {children}
    </div>
  );
}
