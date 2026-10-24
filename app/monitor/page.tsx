"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import PageNav from "@/components/nav/PageNav";
import { recheckTarget } from "@/lib/investigation/watch";
import { listTargets, removeTarget, saveTarget } from "@/lib/storage/watch";
import {
  RESULT_STATUS_LABEL,
  type ResultStatus,
  type WatchDiff,
  type WatchTarget,
} from "@/types/prism";

/**
 * 监控中心 · 持续盯梢（§10）
 *
 * 这个模块是**真实运行**的：每次复查都会真实调用元宝搜索。
 * 但它不是服务端定时任务的替代品——没有数据库也没有 cron，
 * 自动复查只在本页面保持打开时按间隔触发，关闭页面即停止，页面里也照实说明。
 */

const INTERVAL_OPTIONS = [15, 30, 60, 180];

export default function MonitorPage() {
  const [targets, setTargets] = useState<WatchTarget[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    setTargets(listTargets());
    setLoaded(true);
  }, []);

  const pushLog = useCallback((line: string) => {
    setLog((prev) =>
      [`${new Date().toLocaleTimeString("zh-CN")} ${line}`, ...prev].slice(0, 40),
    );
  }, []);

  const runRecheck = useCallback(
    async (target: WatchTarget) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setRunningId(target.id);
      pushLog(`开始复查：${target.claim}`);
      try {
        const { target: next, diff } = await recheckTarget(target);
        saveTarget(next);
        setTargets((prev) => prev.map((t) => (t.id === next.id ? next : t)));
        pushLog(
          `复查完成：新增 ${diff.newSources.length} 条来源，失败 ${diff.failedCount} 次${
            diff.statusChanged ? "，结论判定变化" : ""
          }`,
        );
      } catch (err) {
        pushLog(`复查失败：${err instanceof Error ? err.message : "未知错误"}`);
      } finally {
        setRunningId(null);
        busyRef.current = false;
      }
    },
    [pushLog],
  );

  // 自动复查：仅在页面保持打开时按间隔真实触发
  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const active = targets.filter((t) => t.autoEnabled);
    if (active.length === 0) return;

    const minMinutes = Math.min(...active.map((t) => t.intervalMinutes));
    timerRef.current = setInterval(
      () => {
        if (busyRef.current) return;
        const due = listTargets().filter(
          (t) =>
            t.autoEnabled &&
            Date.now() - new Date(t.lastCheckedAt).getTime() >=
              t.intervalMinutes * 60 * 1000,
        );
        if (due.length === 0) return;
        void runRecheck(due[0]);
      },
      Math.max(minMinutes, 1) * 60 * 1000,
    );

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [targets, runRecheck]);

  const toggleAuto = (t: WatchTarget) => {
    const next = { ...t, autoEnabled: !t.autoEnabled };
    saveTarget(next);
    setTargets((prev) => prev.map((x) => (x.id === next.id ? next : x)));
  };

  const changeInterval = (t: WatchTarget, minutes: number) => {
    const next = { ...t, intervalMinutes: minutes };
    saveTarget(next);
    setTargets((prev) => prev.map((x) => (x.id === next.id ? next : x)));
  };

  const drop = (t: WatchTarget) => {
    removeTarget(t.id);
    setTargets((prev) => prev.filter((x) => x.id !== t.id));
  };

  return (
    <main className="mx-auto w-full max-w-[1000px] px-6 py-8 md:px-8">
      <header className="mb-8 flex flex-wrap items-center gap-x-6 gap-y-3">
        <PageNav />
        <Link href="/" className="flex items-baseline gap-3">
          <span className="display-serif text-[20px] tracking-[0.18em]">PRISM</span>
          <span className="label-en">Evidence Observatory</span>
        </Link>
        <span className="label-en ml-auto">Monitor</span>
      </header>

      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="display-serif text-[clamp(1.8rem,4vw,2.6rem)]">持续盯梢</h1>
        <span
          className="label-en border px-3 py-1.5"
          style={{
            color: "var(--prism-accent)",
            borderColor: "var(--prism-accent)66",
          }}
        >
          真实复查 / Live recheck
        </span>
      </div>

      <p className="mt-4 max-w-[76ch] text-[14px] leading-[1.85] text-[var(--prism-silver)]">
        盯住一个说法，系统会按你设定的间隔重新执行当初那几条查询词，
        并把检索范围限定在<b>最近 7 天</b>，专门找上次之后新出现的内容。
        每次复查都是真实调用元宝搜索，没有预置结果。
      </p>

      <section className="mt-5 glass-panel p-5">
        <h2 className="label-en">它的边界（照实说明）</h2>
        <ul className="mt-3 grid gap-2 text-[13px] leading-relaxed text-[var(--prism-silver)]">
          <li className="border-l-2 border-[var(--prism-hairline-strong)] pl-3">
            部署环境没有服务端定时任务，也没有数据库。自动复查只在<b>本页面保持打开</b>时触发，关闭标签页或无人打开时不会执行。
          </li>
          <li className="border-l-2 border-[var(--prism-hairline-strong)] pl-3">
            快照存在当前浏览器本地存储，换设备或清缓存后不可恢复。
          </li>
          <li className="border-l-2 border-[var(--prism-hairline-strong)] pl-3">
            复查限定在最近 7 天的时间窗内，与不限时间的首次调查口径不同，所以只报「新出现的来源」，
            不算「未再检索到」——后者会把「不在时间窗内」误读成「来源已消失」。
          </li>
          <li className="border-l-2 border-[var(--prism-hairline-strong)] pl-3">
            结论是否变化由模型对<b>新增证据</b>做增量判断，属参考意见；要拿到新结论请对完整结果重新发起一次调查。
          </li>
        </ul>
      </section>

      {loaded && targets.length === 0 ? (
        <section className="mt-8 glass-panel p-6">
          <h2 className="display-serif text-[19px]">还没有盯梢目标</h2>
          <p className="mt-3 max-w-[70ch] text-[13.5px] leading-relaxed text-[var(--prism-silver)]">
            先去首页做一次调查，在报告页底部点「盯住这个说法」，这个说法就会出现在列表里。
          </p>
          <Link
            href="/"
            className="mt-5 inline-block border border-[var(--prism-hairline-strong)] px-5 py-2.5 text-[13px] hover:border-[var(--prism-accent)] hover:text-[var(--prism-accent)]"
          >
            去发起调查
          </Link>
        </section>
      ) : null}

      <section className="mt-8 grid gap-4">
        {targets.map((t) => (
          <article key={t.id} className="glass-panel p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] leading-relaxed">{t.claim}</p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--prism-silver-dim)]">
                  <span>最近复查 {formatTime(t.lastCheckedAt)}</span>
                  <span>已存快照 {t.snapshots.length} 份</span>
                  <span>复查查询词 {t.queries.length} 条</span>
                </div>
              </div>
              <div className="text-right">
                <div className="label-en">当前结论</div>
                <p
                  className="mt-1 text-[15px]"
                  style={{ color: statusColor(t.snapshots[t.snapshots.length - 1]?.resultStatus) }}
                >
                  {statusLabel(t.snapshots[t.snapshots.length - 1]?.resultStatus)}
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void runRecheck(t)}
                disabled={runningId === t.id}
                className="border border-[var(--prism-hairline-strong)] px-4 py-2 text-[13px] hover:border-[var(--prism-accent)] hover:text-[var(--prism-accent)] disabled:opacity-50"
              >
                {runningId === t.id ? "正在真实检索…" : "立即复查"}
              </button>

              <button
                type="button"
                onClick={() => toggleAuto(t)}
                className="border border-[var(--prism-hairline-strong)] px-4 py-2 text-[13px] hover:border-[var(--prism-accent)] hover:text-[var(--prism-accent)]"
              >
                自动复查：{t.autoEnabled ? "开" : "关"}
              </button>

              <label className="flex items-center gap-2 text-[12.5px] text-[var(--prism-silver-dim)]">
                间隔
                <select
                  value={t.intervalMinutes}
                  onChange={(e) => changeInterval(t, Number(e.target.value))}
                  className="border border-[var(--prism-hairline-strong)] bg-transparent px-2 py-1 text-[12.5px]"
                >
                  {INTERVAL_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {m} 分钟
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                onClick={() => drop(t)}
                className="label-en underline decoration-dotted underline-offset-4"
              >
                取消盯梢
              </button>
            </div>

            {t.lastDiff ? <DiffView diff={t.lastDiff} /> : null}
          </article>
        ))}
      </section>

      {log.length > 0 ? (
        <section className="mt-8">
          <h2 className="label-en">执行日志</h2>
          <ul className="mt-3 grid gap-1">
            {log.map((l, i) => (
              <li key={i} className="text-[12px] text-[var(--prism-silver-dim)]">
                · {l}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}

function DiffView({ diff }: { diff: WatchDiff }) {
  return (
    <div className="mt-5 border-t border-[var(--prism-hairline)] pt-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[var(--prism-silver-dim)]">
        <span>上次复查 {formatTime(diff.checkedAt)}</span>
        <span>执行 {diff.searchCount} 次查询</span>
        <span>检索时间窗 {freshnessLabel(diff.freshness)}</span>
        {diff.failedCount > 0 ? (
          <span style={{ color: "#ff6b6b" }}>失败 {diff.failedCount} 次</span>
        ) : null}
        {diff.error ? (
          <span style={{ color: "#ff6b6b" }}>{diff.error}</span>
        ) : null}
      </div>

      {diff.statusChanged ? (
        <p
          className="mt-3 border-l-2 px-3 py-2 text-[13.5px] leading-relaxed"
          style={{ borderColor: "var(--prism-accent)", color: "var(--prism-ink)" }}
        >
          结论判定已变化：{statusLabel(diff.fromStatus)} → {statusLabel(diff.toStatus)}
          。这是模型依据新增证据给出的增量判断，要得到正式结论请重新发起一次完整调查。
        </p>
      ) : null}

      {diff.assessment ? (
        <p className="mt-3 text-[13px] leading-relaxed text-[var(--prism-silver)]">
          增量判断：{diff.assessment.changed ? "足以影响结论" : "不足以改变结论"} ——{" "}
          {diff.assessment.reason}
        </p>
      ) : null}

      <div className="mt-4">
        <h3 className="label-en">
          时间窗内新出现的来源 · {diff.newSources.length}
        </h3>
        {diff.newSources.length === 0 ? (
          <p className="mt-2 max-w-[70ch] text-[12.5px] leading-relaxed text-[var(--prism-silver-dim)]">
            在「{freshnessLabel(diff.freshness)}」这个时间窗内，没有检索到上次快照之外的新来源。
            这说明该说法的证据面在此期间没有出现新内容，是有效结果，不是故障。
          </p>
        ) : (
          <>
            <ul className="mt-2 grid gap-2">
              {diff.newSources.map((s, i) => (
                <li key={i}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer external"
                    className="text-[13px] underline decoration-dotted underline-offset-4 hover:text-[var(--prism-accent)]"
                  >
                    {s.title}
                  </a>
                  <span className="ml-2 text-[11.5px] text-[var(--prism-silver-dim)]">
                    {s.siteName ?? "站点未知"}
                    {s.publishedAt ? ` · ${s.publishedAt}` : ""}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--prism-silver-dim)]">
              复查限定在最近的时间窗内，与不限时间的首次调查口径不同，
              因此这里只列出新出现的来源，不做「未再检索到」的比对——
              那会把「不在时间窗内」误读成「来源已消失」。
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function freshnessLabel(f: string): string {
  if (!f) return "不限时间";
  if (f === "d") return "当天";
  const m = /^([dmy])(\d+)$/.exec(f);
  if (!m) return f;
  const unit = m[1] === "d" ? "天" : m[1] === "m" ? "个月" : "年";
  return `最近 ${m[2]} ${unit}`;
}

function statusLabel(s: ResultStatus | null | undefined): string {
  if (!s) return "未判定";
  return RESULT_STATUS_LABEL[s]?.zh ?? s;
}

function statusColor(s: ResultStatus | null | undefined): string {
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
