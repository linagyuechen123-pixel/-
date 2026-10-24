"use client";

/**
 * 首页：黑镜入口（§4.1 A）
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import LiquidMirror from "@/components/mirror/LiquidMirror";
import { LensTerm } from "@/components/motion/BilingualLens";
import { listRecent, type RecentSummary } from "@/lib/storage/local";
import { RESULT_STATUS_LABEL, type ResultStatus } from "@/types/prism";
import Link from "next/link";

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
  const [collapsed, setCollapsed] = useState(false);

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
        // 服务未就绪 / 请求失败 ≠ 密钥缺失，必须区分，避免误报
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
      setCollapsed(true);
      setTimeout(() => router.push(`/investigate/${id}`), 620);
    },
    [router],
  );

  const remaining = MAX_CLAIM_LENGTH - claim.length;

  return (
    <main className="relative min-h-dvh overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.55]"
        style={{
          background:
            "radial-gradient(120% 80% at 50% -10%, rgba(216,255,117,0.10) 0%, rgba(9,11,16,0) 55%), radial-gradient(80% 60% at 110% 20%, rgba(107,184,255,0.08) 0%, rgba(9,11,16,0) 60%)",
        }}
      />

      <div className="mx-auto flex min-h-dvh w-full max-w-[1180px] flex-col px-6 py-8 md:px-10">
        <header className="flex items-center justify-between">
          <div className="flex items-baseline gap-3">
            <span className="display-serif text-[22px] tracking-[0.18em]">
              PRISM
            </span>
            <span className="label-en">Evidence Observatory</span>
          </div>
          <nav className="flex items-center gap-5 text-[13px]">
            <Link
              href="/monitor"
              className="text-[var(--prism-silver)] transition-colors hover:text-[var(--prism-accent)]"
            >
              监控中心
            </Link>
            <Link
              href="/upload"
              className="text-[var(--prism-silver)] transition-colors hover:text-[var(--prism-accent)]"
            >
              截图查证
            </Link>
          </nav>
        </header>

        <section className="flex flex-1 flex-col justify-center py-14 md:py-20">
          <LiquidMirror collapsed={collapsed} className="w-full">
            <div className="grid gap-10 md:grid-cols-[1.15fr_0.85fr] md:items-end">
              <div>
                <div className="label-en">
                  Fact investigation · Real search only
                </div>
                <h1 className="display-serif mt-5 text-[clamp(2.6rem,7vw,5.4rem)] leading-[0.95]">
                  证据
                  <span className="mx-2 text-[var(--prism-accent)]">折射</span>
                  室
                </h1>
                <p className="mt-6 max-w-[46ch] text-[15px] leading-[1.85] text-[var(--prism-silver)]">
                  输入一句你在生活中听到的说法，或上传一张截图。PRISM
                  会把它拆成可独立核验的
                  <LensTerm en="CLAIM" zh="命题" />
                  ，调用真实搜索引擎检索公开信息，区分支持与反对的
                  <LensTerm en="EVIDENCE" zh="证据" />
                  ，并给出一份每条结论都能追溯到原始
                  <LensTerm en="SOURCE" zh="来源" />
                  的报告。
                </p>
                <p className="mt-3 max-w-[46ch] text-[13px] leading-[1.8] text-[var(--prism-silver-dim)]">
                  PRISM 不宣称能判断一切真假。证据不足时，它会明确告诉你证据不足。
                </p>
              </div>

              <div className="glass-panel p-5 md:p-6">
                <label htmlFor="claim-input" className="label-en block">
                  待核验的说法 / Claim
                </label>
                <textarea
                  id="claim-input"
                  value={claim}
                  onChange={(e) => setClaim(e.target.value)}
                  maxLength={MAX_CLAIM_LENGTH}
                  rows={4}
                  disabled={submitting}
                  placeholder="例如：金属饭盒不能放进微波炉加热"
                  className="mt-3 w-full resize-none border-0 border-b border-[var(--prism-hairline)] bg-transparent pb-3 text-[16px] leading-[1.7] text-[var(--prism-ink)] outline-none placeholder:text-[var(--prism-silver-dim)] focus:border-[var(--prism-accent)] disabled:opacity-50"
                />
                <div className="mt-2 flex items-center justify-between text-[12px] text-[var(--prism-silver-dim)]">
                  <span>
                    {error ? (
                      <span className="text-[#ff6b6b]">{error}</span>
                    ) : (
                      "建议写成一句完整陈述，越具体越容易核验"
                    )}
                  </span>
                  <span>{remaining}</span>
                </div>

                <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => go(claim)}
                    disabled={submitting || claim.trim().length === 0}
                    className="flex-1 border border-[var(--prism-accent)] bg-[var(--prism-accent)] px-5 py-3 text-[13px] font-medium uppercase tracking-[0.14em] text-[var(--prism-void)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:border-[var(--prism-hairline)] disabled:bg-transparent disabled:text-[var(--prism-silver-dim)]"
                  >
                    {submitting ? "正在进入…" : "启动调查 / Investigate"}
                  </button>
                  <Link
                    href="/upload"
                    className="flex-1 border border-[var(--prism-hairline-strong)] px-5 py-3 text-center text-[13px] uppercase tracking-[0.14em] text-[var(--prism-ink)] transition-colors hover:border-[var(--prism-accent)] hover:text-[var(--prism-accent)]"
                  >
                    上传截图 / OCR
                  </Link>
                </div>

                <div className="mt-5 border-t border-[var(--prism-hairline)] pt-4">
                  <div className="label-en mb-2">示例</div>
                  <div className="flex flex-wrap gap-2">
                    {EXAMPLES.map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => setClaim(e)}
                        disabled={submitting}
                        className="border border-[var(--prism-hairline)] px-3 py-1.5 text-left text-[12.5px] leading-snug text-[var(--prism-silver)] transition-colors hover:border-[var(--prism-accent)] hover:text-[var(--prism-accent)]"
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </LiquidMirror>
        </section>

        <section className="pb-6">
          {recent.length > 0 ? (
            <div className="mb-8">
              <div className="label-en mb-3">最近的调查 / Recent</div>
              <ul className="grid gap-2 sm:grid-cols-2">
                {recent.slice(0, 4).map((r) => (
                  <li key={r.id}>
                    <a
                      href={`/report/${r.id}`}
                      className="glass-panel flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:border-[var(--prism-accent)]"
                    >
                      <span className="truncate text-[13.5px]">{r.claim}</span>
                      <span className="label-en shrink-0">
                        {r.resultStatus
                          ? (RESULT_STATUS_LABEL[r.resultStatus as ResultStatus]?.zh ??
                            r.status)
                          : r.status}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-col gap-3 border-t border-[var(--prism-hairline)] pt-5 text-[12px] leading-relaxed text-[var(--prism-silver-dim)] md:flex-row md:items-start md:justify-between">
            <p className="max-w-[70ch]">
              隐私与使用说明：调查记录仅保存在你当前浏览器的本地存储中，不上传、不跨设备同步。搜索由服务端调用元宝搜索，密钥只存在于服务端环境变量。请勿上传包含个人隐私或未授权内容的图片。搜索结果属于外部内容，本系统只做整理，不为来源内容担保。
            </p>
            <p className="shrink-0">
              搜索服务状态：
              {searchReady === "checking" ? (
                "检查中…"
              ) : searchReady === "ready" ? (
                <span className="text-[var(--prism-accent)]">已配置</span>
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
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
