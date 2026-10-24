"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * 子页面左上角导航：返回 + 回到首页。
 *
 * 所有子页面共用，保证位置、间距与动效一致。
 * 动效统一走 globals.css 的 .prism-* 类：弹入 + hover 上浮 + 按下回弹 + 箭头轻推，
 * 同一套类名后续新增 UI 继续复用（prefers-reduced-motion 下由全局规则关闭）。
 */
export default function PageNav({ className }: { className?: string }) {
  const router = useRouter();

  const goBack = () => {
    // 直接打开子页（无历史记录）时 back 无反应，退回首页，避免出现点了不动的按钮
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  };

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className ?? ""}`}>
      <button
        type="button"
        onClick={goBack}
        className="prism-nav-btn prism-pop-in"
        style={{ animationDelay: "0ms" }}
        aria-label="返回上一页"
      >
        <span className="prism-nav-glyph" aria-hidden="true">
          ←
        </span>
        返回
      </button>

      <Link
        href="/"
        className="prism-nav-btn prism-pop-in"
        style={{ animationDelay: "90ms" }}
        aria-label="回到首页"
      >
        <span className="prism-nav-glyph prism-nav-glyph-y" aria-hidden="true">
          ◈
        </span>
        回到首页
      </Link>
    </div>
  );
}
