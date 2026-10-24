import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PRISM｜证据折射室",
  description:
    "PRISM 是一个基于真实搜索的沉浸式事实调查工具：提出问题 → 拆解命题 → 搜索证据 → 核验来源 → 形成结论 → 复核报告。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
