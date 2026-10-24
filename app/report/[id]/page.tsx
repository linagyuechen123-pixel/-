"use client";

/**
 * 报告页：从本地存储还原调查记录（§4.1 D）
 * 找不到记录时明确说明原因，不使用任何演示数据填充。
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ReportView from "@/components/report/ReportView";
import { loadBundle } from "@/lib/storage/local";
import type { InvestigationBundle } from "@/types/prism";
import Link from "next/link";
import PageNav from "@/components/nav/PageNav";

export default function ReportPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const [state, setState] = useState<
    "loading" | "found" | "missing"
  >("loading");
  const [bundle, setBundle] = useState<InvestigationBundle | null>(null);

  useEffect(() => {
    if (!id) return;
    const b = loadBundle(id);
    if (b) {
      setBundle(b);
      setState("found");
    } else {
      setState("missing");
    }
  }, [id]);

  return (
    <main className="mx-auto w-full max-w-[1120px] px-6 py-8 md:px-8">
      <header className="mb-8 flex flex-wrap items-center gap-x-6 gap-y-3">
        <PageNav />
        <Link href="/" className="flex items-baseline gap-3">
          <span className="display-serif text-[20px] tracking-[0.18em]">PRISM</span>
          <span className="label-en">Evidence Observatory</span>
        </Link>
        <span className="label-en ml-auto">{id}</span>
      </header>

      {state === "loading" ? (
        <p className="text-[13.5px] text-[var(--prism-silver)]">正在读取本地调查记录…</p>
      ) : null}

      {state === "missing" ? (
        <section className="glass-panel p-6">
          <h1 className="display-serif text-[20px]">未找到该调查记录</h1>
          <p className="mt-3 max-w-[70ch] text-[13.5px] leading-relaxed text-[var(--prism-silver)]">
            调查编号 <span className="text-[var(--prism-ink)]">{id}</span>{" "}
            在当前浏览器中不存在。首期不使用数据库，记录只保存在发起调查的那台设备的浏览器本地存储中：更换浏览器或设备、清除浏览器数据都会导致记录不可恢复。
          </p>
          <Link
            href="/"
            className="mt-5 inline-block border border-[var(--prism-hairline-strong)] px-5 py-2.5 text-[13px] hover:border-[var(--prism-accent)] hover:text-[var(--prism-accent)]"
          >
            返回首页重新调查
          </Link>
        </section>
      ) : null}

      {state === "found" && bundle ? <ReportView bundle={bundle} /> : null}
    </main>
  );
}
