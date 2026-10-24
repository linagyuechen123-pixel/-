"use client";

/**
 * 本地持久化（§11.2 数据层）
 *
 * 重要限制：首期不使用数据库，调查记录只保存在当前浏览器本地存储中。
 * 清除浏览器数据、更换设备或浏览器后记录不可恢复，也不跨设备同步。
 * 服务端仅在本次运行进程的内存中缓存一份，进程重启即失效。
 */

import type { InvestigationBundle } from "@/types/prism";

const KEY_INDEX = "prism:investigations:index";
const KEY_PREFIX = "prism:investigation:";
const MAX_RECORDS = 20;

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function saveBundle(bundle: InvestigationBundle): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      `${KEY_PREFIX}${bundle.investigation.id}`,
      JSON.stringify(bundle),
    );
    const index = listIndex();
    const next = [
      bundle.investigation.id,
      ...index.filter((id) => id !== bundle.investigation.id),
    ].slice(0, MAX_RECORDS);
    localStorage.setItem(KEY_INDEX, JSON.stringify(next));
  } catch {
    // 存储失败不阻断核心流程，只影响历史记录
  }
}

export function loadBundle(id: string): InvestigationBundle | null {
  if (typeof window === "undefined") return null;
  return safeParse<InvestigationBundle>(
    localStorage.getItem(`${KEY_PREFIX}${id}`),
  );
}

export function listIndex(): string[] {
  if (typeof window === "undefined") return [];
  return safeParse<string[]>(localStorage.getItem(KEY_INDEX)) ?? [];
}

export interface RecentSummary {
  id: string;
  claim: string;
  createdAt: string;
  resultStatus: string | null;
  status: string;
}

export function listRecent(): RecentSummary[] {
  return listIndex()
    .map((id) => loadBundle(id))
    .filter((b): b is InvestigationBundle => b !== null)
    .map((b) => ({
      id: b.investigation.id,
      claim: b.investigation.originalClaim,
      createdAt: b.investigation.createdAt,
      resultStatus: b.investigation.resultStatus,
      status: b.investigation.status,
    }));
}

export function deleteBundle(id: string): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(`${KEY_PREFIX}${id}`);
  localStorage.setItem(
    KEY_INDEX,
    JSON.stringify(listIndex().filter((x) => x !== id)),
  );
}

/** 服务端短时缓存：仅在本次进程内有效 */
const serverCache = new Map<string, InvestigationBundle>();

export function cacheBundle(bundle: InvestigationBundle): void {
  serverCache.set(bundle.investigation.id, bundle);
  if (serverCache.size > 50) {
    const oldest = serverCache.keys().next().value;
    if (oldest) serverCache.delete(oldest);
  }
}

export function getCachedBundle(id: string): InvestigationBundle | null {
  return serverCache.get(id) ?? null;
}
