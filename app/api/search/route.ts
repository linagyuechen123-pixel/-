/**
 * 单次真实搜索（§11.4 /api/search）
 *
 * 前端通过本路由执行搜索，密钥只存在于服务端环境变量。
 * 任何失败都返回结构化错误，不回退到任何静态数据。
 */

import { NextResponse } from "next/server";
import { searchPro } from "@/lib/search/wsa";
import { ROUND_TYPES, type RoundType } from "@/types/prism";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_QUERY_LENGTH = 500;

function badRequest(message: string) {
  return NextResponse.json(
    { ok: false, code: "SEARCH_INVALID_REQUEST", message },
    { status: 400 },
  );
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("请求体不是合法 JSON。");
  }

  const payload = body as {
    query?: unknown;
    roundId?: unknown;
    roundType?: unknown;
    mode?: unknown;
    cnt?: unknown;
    freshness?: unknown;
    industry?: unknown;
    site?: unknown;
  };

  const query = typeof payload.query === "string" ? payload.query.trim() : "";
  if (!query) return badRequest("查询词不能为空。");
  if (query.length > MAX_QUERY_LENGTH) {
    return badRequest(`查询词超过 ${MAX_QUERY_LENGTH} 字符上限。`);
  }

  const roundId =
    typeof payload.roundId === "string" && payload.roundId.trim()
      ? payload.roundId.trim().slice(0, 64)
      : `R-${Date.now()}`;

  let roundType: RoundType = "initial";
  if (typeof payload.roundType === "string" && payload.roundType in ROUND_TYPES_SET) {
    roundType = payload.roundType as RoundType;
  }

  const mode =
    payload.mode === 0 || payload.mode === 1 || payload.mode === 2
      ? payload.mode
      : 2;

  const cnt =
    typeof payload.cnt === "number" && [10, 20, 30, 40, 50].includes(payload.cnt)
      ? payload.cnt
      : 10;

  const outcome = await searchPro({
    query,
    roundId,
    roundType,
    mode,
    cnt,
    freshness: typeof payload.freshness === "string" ? payload.freshness : undefined,
    industry: typeof payload.industry === "string" ? payload.industry : undefined,
    site: typeof payload.site === "string" ? payload.site : undefined,
  });

  if (!outcome.ok) {
    // 不下发 detail（可能含服务端诊断信息），仅记录
    if (outcome.detail) {
      console.warn(
        `[prism][search] ${outcome.code} ${outcome.detail} round=${roundId}`,
      );
    }
    return NextResponse.json(
      { ok: false, code: outcome.code, message: outcome.message },
      { status: 200 },
    );
  }

  return NextResponse.json({
    ok: true,
    results: outcome.results,
    roundId: outcome.roundId,
    query: outcome.query,
    retrievedAt: outcome.retrievedAt,
  });
}

const ROUND_TYPES_SET: Record<string, true> = Object.fromEntries(
  ROUND_TYPES.map((t) => [t, true as const]),
);
