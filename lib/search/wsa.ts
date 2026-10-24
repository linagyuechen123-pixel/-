/**
 * 元宝搜索（SearchPro）服务端接入
 * 依据 PRISM-HO-001 §6 搜索引擎接入规范
 *
 * 官方接口（2026-10-24 实测核对）：
 *   端点   POST https://api.wsa.cloud.tencent.com/SearchPro
 *   鉴权   Authorization: Bearer <key>
 *   请求体 Action=SearchPro, Version=2025-05-08, Query, Mode, Cnt, Site, Freshness, Industry
 *   结果   Response.Pages —— 数组元素为 JSON 字符串，需二次解析
 *          元素字段 title / url / passage / site / date / score
 *
 * 本模块只在服务端运行。禁止被客户端组件引用。
 */

import {
  SEARCH_ERROR_CODES,
  type RoundType,
  type SearchFailure,
  type SearchOutcome,
  type SearchResult,
} from "@/types/prism";

const ENDPOINT = "https://api.wsa.cloud.tencent.com/SearchPro";
const API_VERSION = "2025-05-08";
const DEFAULT_TIMEOUT_MS = 15_000;

/** 返回条数只能取 10/20/30/40/50 */
const ALLOWED_CNTS = [10, 20, 30, 40, 50] as const;

export interface SearchParams {
  query: string;
  roundId: string;
  roundType?: RoundType;
  mode?: 0 | 1 | 2;
  cnt?: number;
  site?: string;
  freshness?: string;
  industry?: string;
}

function readApiKey(): string | null {
  const primary = process.env.WSA_API_KEY?.trim();
  if (primary) return primary;
  const compat = process.env.TENCENTCLOUD_WSA_APIKEY?.trim();
  return compat || null;
}

/** 是否存在可用凭证（供健康检查 / 配置提示使用，不返回值） */
export function hasSearchCredential(): boolean {
  return readApiKey() !== null;
}

function fail(
  code: SearchFailure["code"],
  message: string,
  detail?: string,
): SearchFailure {
  return { ok: false, code, message, detail };
}

/**
 * URL 规范化，仅用于去重键。
 * 用户最终看到的永远是原始 url（§6.5）。
 */
export function canonicalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const path = u.pathname.replace(/\/+$/, "");
    const tracking = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "spm",
      "from",
      "ref",
      "share_token",
    ];
    tracking.forEach((k) => u.searchParams.delete(k));
    const search = u.searchParams.toString();
    return `${u.protocol}//${host}${path}${search ? `?${search}` : ""}`.toLowerCase();
  } catch {
    return raw.trim().toLowerCase();
  }
}

interface RawPage {
  title?: unknown;
  url?: unknown;
  passage?: unknown;
  site?: unknown;
  date?: unknown;
  score?: unknown;
  authority_level?: unknown;
}

function toStr(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t.length > 0 ? t : null;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function toScore(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizePage(
  page: RawPage,
  query: string,
  roundId: string,
  retrievedAt: string,
  index: number,
): SearchResult | null {
  const url = toStr(page.url);
  const title = toStr(page.title);
  // §6.4：无标题或无 url 的结果不得生成来源卡片
  if (!url || !title) return null;
  if (!/^https?:\/\//i.test(url)) return null;

  return {
    id: `S-${roundId}-${index + 1}`,
    title,
    url,
    snippet: toStr(page.passage) ?? "",
    publishedAt: toStr(page.date),
    siteName: toStr(page.site),
    relevanceScore: toScore(page.score),
    query,
    roundId,
    retrievedAt,
    canonicalUrl: canonicalizeUrl(url),
  };
}

function normalizeCnt(cnt?: number): number {
  if (!cnt) return 10;
  return (ALLOWED_CNTS as readonly number[]).includes(cnt) ? cnt : 10;
}

/**
 * 执行真实搜索。
 * 任一环节失败都返回结构化错误，绝不产生静态/伪造结果。
 */
export async function searchPro(
  params: SearchParams,
): Promise<SearchOutcome> {
  const query = params.query?.trim();
  if (!query) {
    return fail(
      SEARCH_ERROR_CODES.INVALID_QUERY,
      "查询词为空，未发起搜索请求。",
    );
  }
  if (query.length > 500) {
    return fail(
      SEARCH_ERROR_CODES.INVALID_QUERY,
      "查询词过长（上限 500 字符），未发起搜索请求。",
    );
  }

  const apiKey = readApiKey();
  if (!apiKey) {
    return fail(
      SEARCH_ERROR_CODES.MISSING_KEY,
      "服务端未配置搜索密钥，无法执行真实搜索。请在环境变量中设置 WSA_API_KEY。",
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  const body: Record<string, unknown> = {
    Action: "SearchPro",
    Version: API_VERSION,
    Query: query,
    Mode: params.mode ?? 2,
    Cnt: normalizeCnt(params.cnt),
  };
  if (params.site) body.Site = params.site;
  if (params.freshness) body.Freshness = params.freshness;
  if (params.industry) body.Industry = params.industry;

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });

    if (res.status === 401 || res.status === 403) {
      return fail(
        SEARCH_ERROR_CODES.UNAUTHORIZED,
        "搜索服务鉴权失败，请检查密钥是否有效。",
        `http_status=${res.status}`,
      );
    }
    if (res.status === 429) {
      return fail(
        SEARCH_ERROR_CODES.RATE_LIMITED,
        "搜索服务请求受限，请稍后重试。",
        `http_status=429`,
      );
    }
    if (!res.ok) {
      return fail(
        SEARCH_ERROR_CODES.NETWORK,
        `搜索服务返回异常状态 ${res.status}。`,
        `http_status=${res.status}`,
      );
    }

    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      return fail(
        SEARCH_ERROR_CODES.BAD_RESPONSE,
        "搜索服务返回内容不是合法 JSON，已终止解析（未生成任何来源）。",
      );
    }

    const responseBody = (payload as { Response?: Record<string, unknown> })
      ?.Response;

    if (!responseBody || typeof responseBody !== "object") {
      return fail(
        SEARCH_ERROR_CODES.BAD_RESPONSE,
        "搜索服务响应缺少 Response 字段，已终止解析（未生成任何来源）。",
      );
    }

    const apiError = responseBody.Error as
      | { Code?: string; Message?: string }
      | undefined;
    if (apiError?.Code) {
      const code = String(apiError.Code);
      if (code === "UnauthorizedOperation") {
        return fail(
          SEARCH_ERROR_CODES.UNAUTHORIZED,
          "搜索服务鉴权失败（未授权操作），请检查密钥或开通状态。",
          `api_code=${code}`,
        );
      }
      if (code === "LimitExceeded" || code === "RequestLimitExceeded") {
        return fail(
          SEARCH_ERROR_CODES.RATE_LIMITED,
          "已达搜索配额限制，无法继续搜索。",
          `api_code=${code}`,
        );
      }
      return fail(
        SEARCH_ERROR_CODES.NETWORK,
        `搜索服务返回错误：${apiError.Message ?? code}`,
        `api_code=${code}`,
      );
    }

    const rawPages = responseBody.Pages;
    if (!Array.isArray(rawPages)) {
      return fail(
        SEARCH_ERROR_CODES.BAD_RESPONSE,
        "搜索服务响应缺少 Pages 数组，已终止解析（未生成任何来源）。",
      );
    }

    const retrievedAt = new Date().toISOString();
    const results: SearchResult[] = [];

    for (let i = 0; i < rawPages.length; i++) {
      const item = rawPages[i];
      let page: RawPage;
      if (typeof item === "string") {
        try {
          page = JSON.parse(item) as RawPage;
        } catch {
          continue;
        }
      } else if (item && typeof item === "object") {
        page = item as RawPage;
      } else {
        continue;
      }
      const normalized = normalizePage(
        page,
        query,
        params.roundId,
        retrievedAt,
        i,
      );
      if (normalized) results.push(normalized);
    }

    // 去重：同一 canonicalUrl 只保留 score 最高的一条，但保留原始 url
    const deduped = dedupeByCanonical(results);

    if (deduped.length === 0) {
      return {
        ok: true,
        results: [],
        roundId: params.roundId,
        query,
        retrievedAt,
      };
    }

    return {
      ok: true,
      results: deduped,
      roundId: params.roundId,
      query,
      retrievedAt,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return fail(
        SEARCH_ERROR_CODES.TIMEOUT,
        `搜索请求超时（${DEFAULT_TIMEOUT_MS / 1000} 秒），未获取结果。`,
      );
    }
    return fail(
      SEARCH_ERROR_CODES.NETWORK,
      "搜索请求发生网络错误，未获取结果。",
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    clearTimeout(timer);
  }
}

function dedupeByCanonical(results: SearchResult[]): SearchResult[] {
  const map = new Map<string, SearchResult>();
  for (const r of results) {
    const existing = map.get(r.canonicalUrl);
    if (!existing) {
      map.set(r.canonicalUrl, r);
      continue;
    }
    const a = existing.relevanceScore ?? -1;
    const b = r.relevanceScore ?? -1;
    if (b > a) map.set(r.canonicalUrl, r);
  }
  return Array.from(map.values());
}
