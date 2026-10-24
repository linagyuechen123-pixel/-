"use client";

/**
 * 首页：通天藤蔓 · 搜索入口
 *
 * 结构（简约优先）：
 *   第一屏 = 3D 藤蔓场景（可拖动视角）+ 中下方搜索框
 *   下滑   = 最近调查 + 一个深色方框（隐私说明 / 核验入口 / 检索入口 / 技术支持 / 声明）
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { listRecent, type RecentSummary } from "@/lib/storage/local";
import { RESULT_STATUS_LABEL, type ResultStatus } from "@/types/prism";

const VineScene = dynamic(() => import("@/components/scene/VineScene"), {
  ssr: false,
});

const MAX_CLAIM_LENGTH = 300;
const EXAMPLES = [
  "不锈钢保温杯装碳酸饮料会腐蚀内胆",
  "空腹喝牛奶会导致腹泻",
  "手机夜间充电会损伤电池寿命",
];

export default function HomePage() {
  const router = useRouter();
  const [claim, setClaim] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentSummary[]>([]);
  const [searchReady, setSearchReady] = useState<
    "checking" | "ready" | "nokey" | "offline"
  >("checking");

  useEffect(() => {
    setRecent(listRecent());
  }, []);

  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    fetch("/api/health", { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: { searchConfigured: boolean }) => {
        if (alive) setSearchReady(d.searchConfigured ? "ready" : "nokey");
      })
      .catch(() => {
        // 服务未就绪 ≠ 密钥缺失，必须区分，避免误报
        if (alive) setSearchReady("offline");
      })
      .finally(() => clearTimeout(timer));
    return () => {
      alive = false;
      ctrl.abort();
    };
  }, []);

  const go = useCallback(
    (text: string) => {
      const value = text.trim();
      if (!value) {
        setError("请输入需要核验的说法。");
        return;
      }
      if (value.length > MAX_CLAIM_LENGTH) {
        setError(`说法过长，请控制在 ${MAX_CLAIM_LENGTH} 字以内。`);
        return;
      }
      setError(null);
      setSubmitting(true);
      const id = `INV-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 7)}`;
      sessionStorage.setItem(
        `prism:draft:${id}`,
        JSON.stringify({ claim: value, origin: "text", imagePreview: null }),
      );
      // 留出转场时间：搜索框先收缩发光，再进调查页
      setTimeout(() => router.push(`/investigate/${id}`), 520);
    },
    [router],
  );

  const remaining = MAX_CLAIM_LENGTH - claim.length;

  return (
    <main className="relative">
      {/* ---------- 第一屏：藤蔓 + 搜索 ---------- */}
      <section className="relative h-dvh w-full overflow-hidden">
        <VineScene className="absolute inset-0 z-0" nodeCount={28} />

        <header className="relative z-10 mx-auto flex w-full max-w-[1180px] items-center justify-between px-6 pt-8 md:px-10">
          <div className="flex items-baseline gap-3">
            <span className="display-serif text-[22px] tracking-[0.18em]">
              PRISM
            </span>
            <span className="label-en">Evidence Observatory</span>
          </div>
          <nav className="flex items-center gap-5 text-[13px]">
            <Link
              href="/upload"
              className="prism-nav-btn prism-pop-in"
              style={{ animationDelay: "0ms" }}
            >
              截图查证
            </Link>
            <Link
              href="/monitor"
              className="prism-nav-btn prism-pop-in"
              style={{ animationDelay: "90ms" }}
            >
              持续盯梢
            </Link>
          </nav>
        </header>

        {/* 中下方搜索区 */}
        <div className="absolute inset-x-0 bottom-[13%] z-10 px-6 md:bottom-[15%]">
          {/* 内容遮罩：保证标题与搜索框在 3D 场景上仍然可读 */}
          <div
            className="pointer-events-none absolute inset-x-0 -top-16 -bottom-24"
            style={{
              background:
                "radial-gradient(58% 62% at 50% 52%, rgba(6,8,12,0.86) 0%, rgba(6,8,12,0.55) 46%, rgba(6,8,12,0) 78%)",
            }}
            aria-hidden="true"
          />
          <div className="relative mx-auto w-full max-w-[760px]">
            <div className="label-en prism-pop-in text-center">
              Fact investigation · real search only
            </div>
            <h1 className="display-serif prism-pop-in mt-4 text-center text-[clamp(2.2rem,6vw,4.2rem)] leading-[1.02]" style={{ animationDelay: "80ms" }}>
              证据<span className="text-[var(--prism-accent)]">折射</span>室
            </h1>

            <div
              className={`prism-searchbar prism-pop-in mt-8 ${submitting ? "is-submitting" : ""}`}
              style={{ animationDelay: "160ms" }}
            >
              <span className="prism-searchbar-glyph" aria-hidden="true">
                ◈
              </span>
              <input
                id="claim-input"
                value={claim}
                onChange={(e) => setClaim(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    go(claim);
                  }
                }}
                maxLength={MAX_CLAIM_LENGTH}
                disabled={submitting}
                placeholder="输入一句你想核实的话"
                className="prism-searchbar-input"
                aria-label="待核验的说法"
              />
              <button
                type="button"
                onClick={() => go(claim)}
                disabled={submitting || claim.trim().length === 0}
                className="prism-searchbar-btn"
              >
                {submitting ? "进入…" : "核查"}
              </button>
            </div>

            <div
              className="prism-pop-in mt-4 flex flex-wrap items-center justify-center gap-2"
              style={{ animationDelay: "240ms" }}
            >
              {EXAMPLES.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setClaim(e)}
                  disabled={submitting}
                  className="prism-chip"
                >
                  {e}
                </button>
              ))}
            </div>

            <div
              className="prism-pop-in mt-5 text-center text-[12px] text-[var(--prism-silver-dim)]"
              style={{ animationDelay: "300ms" }}
            >
              {error ? (
                <span className="text-[#ff6b6b]">{error}</span>
              ) : searchReady === "checking" ? (
                "正在检查搜索服务…"
              ) : searchReady === "ready" ? (
                <>
                  <span className="text-[var(--prism-accent)]">元宝搜索已连接</span>
                  <span className="mx-2 opacity-40">·</span>
                  剩余 {remaining} 字
                  <span className="mx-2 opacity-40">·</span>
                  按住左键左右拖动可转动视角
                </>
              ) : searchReady === "nokey" ? (
                <span className="text-[#ff6b6b]">
                  未配置密钥（无法执行真实搜索）
                </span>
              ) : (
                <>
                  <span className="text-[#ffb454]">
                    服务未响应（密钥状态未知）
                  </span>
                  <button
                    type="button"
                    onClick={() => location.reload()}
                    className="ml-2 underline underline-offset-2 transition-opacity hover:opacity-70"
                  >
                    重试
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* 下滑提示 */}
        <div className="pointer-events-none absolute inset-x-0 bottom-5 z-10 flex justify-center">
          <span className="prism-scroll-hint label-en">向下滑动</span>
        </div>
      </section>

      {/* ---------- 第二屏：最近调查 + 深色方框 ---------- */}
      <section className="relative z-10 mx-auto w-full max-w-[1180px] px-6 pb-20 pt-10 md:px-10">
        {recent.length > 0 ? (
          <div className="mb-8">
            <div className="label-en mb-3">最近的调查 / Recent</div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {recent.slice(0, 4).map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/report/${r.id}`}
                    className="prism-row"
                  >
                    <span className="truncate text-[13.5px]">{r.claim}</span>
                    <span className="label-en shrink-0">
                      {r.resultStatus
                        ? (RESULT_STATUS_LABEL[r.resultStatus as ResultStatus]?.zh ??
                          r.status)
                        : r.status}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* 深色方框：隐私 / 入口 / 支持 / 声明 */}
        <div className="prism-footerbox">
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            <div>
              <h2 className="label-en">隐私说明</h2>
              <p className="mt-3 text-[13px] leading-[1.85] text-[var(--prism-silver)]">
                调查记录只保存在你当前浏览器的本地存储里，不上传、不跨设备同步，清除浏览器数据即不可恢复。上传的截图在浏览器本地完成文字识别，图片本身不会发送到服务端。请勿上传含个人隐私或未授权内容的图片。
              </p>
            </div>

            <div>
              <h2 className="label-en">核验入口</h2>
              <ul className="mt-3 grid gap-2 text-[13px]">
                <li>
                  <Link href="/upload" className="prism-inline-link">
                    截图查证 / OCR
                  </Link>
                  <span className="ml-2 text-[var(--prism-silver-dim)]">
                    上传一张图，先认字再核查
                  </span>
                </li>
                <li>
                  <Link href="/monitor" className="prism-inline-link">
                    持续盯梢
                  </Link>
                  <span className="ml-2 text-[var(--prism-silver-dim)]">
                    定期复查，找新出现的来源
                  </span>
                </li>
              </ul>

              <h2 className="label-en mt-6">检索入口</h2>
              <p className="mt-3 text-[13px] leading-[1.85] text-[var(--prism-silver)]">
                所有检索都经服务端调用元宝搜索，密钥只存在于服务端环境变量，浏览器拿不到。返回的全部来源均为真实检索结果，模型不生成任何来源。
              </p>
            </div>

            <div>
              <h2 className="label-en">技术支持</h2>
              <ul className="mt-3 grid gap-1.5 text-[13px] text-[var(--prism-silver)]">
                <li>检索：元宝搜索 SearchPro</li>
                <li>推理与报告：WorkBuddy 云服务大模型</li>
                <li>文字识别：Tesseract.js（浏览器本地）</li>
                <li>应用框架：Next.js · 三维场景：three.js</li>
              </ul>

              <h2 className="label-en mt-6">声明</h2>
              <p className="mt-3 text-[13px] leading-[1.85] text-[var(--prism-silver)]">
                PRISM 不宣称能判断一切真假。证据不足时它会明确写出证据不足，冲突就标注冲突，不抹平。搜索结果属于外部内容，本系统只做整理与溯源，不为来源内容的准确性担保。
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
