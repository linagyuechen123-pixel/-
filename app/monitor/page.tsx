"use client";
import Link from "next/link";

/**
 * 监控中心（§4.1 F / §10.2）
 *
 * 状态：未启用。
 * 每日自动监控需要：持久化数据库 + 服务端定时任务 + 可靠通知渠道。
 * 当前部署环境不提供数据库与服务端定时调度，因此该功能未实现，
 * 按 §10.2 要求明确显示「未启用」，不使用手动刷新冒充自动监控。
 */

export default function MonitorPage() {
  const requirements = [
    {
      item: "元宝搜索凭证",
      state: "可配置",
      note: "通过服务端环境变量 WSA_API_KEY 提供；缺失时搜索不可用。",
    },
    {
      item: "持久化数据库",
      state: "未启用",
      note: "首期不使用数据库，调查记录仅保存在浏览器本地存储，服务端无法跨会话读取。",
    },
    {
      item: "服务端定时任务",
      state: "未提供",
      note: "当前部署沙箱不提供 cron / scheduled job，无法保证每日真实执行。",
    },
    {
      item: "历史结果存储",
      state: "未实现",
      note: "没有数据库即无法保存历史快照，也无法做新旧对比。",
    },
    {
      item: "变化检测逻辑",
      state: "未实现",
      note: "缺少历史数据，变化分类（new_source / source_changed 等）无法运行。",
    },
    {
      item: "通知渠道",
      state: "未配置",
      note: "未接入任何真实通知渠道，不提供假的「已发送」状态。",
    },
  ];

  return (
    <main className="mx-auto w-full max-w-[1000px] px-6 py-8 md:px-8">
      <header className="mb-8 flex items-center justify-between">
        <Link href="/" className="flex items-baseline gap-3">
          <span className="display-serif text-[20px] tracking-[0.18em]">PRISM</span>
          <span className="label-en">Evidence Observatory</span>
        </Link>
        <span className="label-en">Monitor</span>
      </header>

      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="display-serif text-[clamp(1.8rem,4vw,2.6rem)]">监控中心</h1>
        <span
          className="label-en border px-3 py-1.5"
          style={{
            color: "var(--prism-spectral-unverified)",
            borderColor: "var(--prism-spectral-unverified)66",
          }}
        >
          未启用 / Not enabled
        </span>
      </div>

      <p className="mt-4 max-w-[74ch] text-[14px] leading-[1.85] text-[var(--prism-silver)]">
        持续盯梢用于每天重复检索同一个命题并比对新旧结果。它需要数据库、服务端定时任务和真实通知渠道三者同时具备才能成立。当前部署环境缺少其中关键环节，因此本模块尚未实现，也没有实际运行过任何定时任务。此处不使用手动刷新冒充自动监控。
      </p>

      <section className="mt-8">
        <h2 className="label-en">前置条件检查</h2>
        <ul className="mt-3 grid gap-2">
          {requirements.map((r) => (
            <li key={r.item} className="glass-panel flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-[14px]">{r.item}</span>
              <span className="flex items-center gap-3">
                <span className="text-[12px] text-[var(--prism-silver-dim)] sm:max-w-[46ch] sm:text-right">
                  {r.note}
                </span>
                <span
                  className="label-en shrink-0"
                  style={{
                    color:
                      r.state === "可配置"
                        ? "var(--prism-accent)"
                        : "var(--prism-spectral-unverified)",
                  }}
                >
                  {r.state}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8 glass-panel p-5">
        <h2 className="label-en">如果现在人工核对</h2>
        <p className="mt-3 text-[13.5px] leading-relaxed text-[var(--prism-silver)]">
          在自动化上线前，可以回到首页对同一句话重新发起一次调查，人工比较两次的来源列表差异。这是真实的重新调查，不是自动监控。
        </p>
        <Link
          href="/"
          className="mt-5 inline-block border border-[var(--prism-hairline-strong)] px-5 py-2.5 text-[13px] hover:border-[var(--prism-accent)] hover:text-[var(--prism-accent)]"
        >
          返回首页发起调查
        </Link>
      </section>
    </main>
  );
}
