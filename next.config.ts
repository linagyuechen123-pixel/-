import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 默认使用 Next.js 标准产物目录 .next，便于部署平台识别与启动。
  // 仅在本地需要隔离产物时通过环境变量切换。
  distDir: process.env.PRISM_DIST_DIR || ".next",
  eslint: {
    // 构建期间不因 lint 规则中断；lint 单独通过 `npm run lint` 执行
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
