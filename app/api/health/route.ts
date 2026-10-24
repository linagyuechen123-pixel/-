import { NextResponse } from "next/server";
import { hasSearchCredential } from "@/lib/search/wsa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 供界面显示真实配置状态（§6.3：缺密钥必须显示配置错误） */
export async function GET() {
  return NextResponse.json({
    searchConfigured: hasSearchCredential(),
    checkedAt: new Date().toISOString(),
  });
}
