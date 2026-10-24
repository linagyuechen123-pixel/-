"use client";

/**
 * 盯梢目标的本地持久化（§10 持续盯梢）
 *
 * 与调查记录一样只保存在当前浏览器本地存储：没有数据库，
 * 服务端无法跨会话读取，也不提供定时任务。清除浏览器数据后盯梢列表不可恢复。
 */

import type { WatchTarget } from "@/types/prism";

const KEY = "prism:watch:targets";
const MAX_TARGETS = 12;

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function listTargets(): WatchTarget[] {
  if (typeof window === "undefined") return [];
  return safeParse<WatchTarget[]>(localStorage.getItem(KEY)) ?? [];
}

export function getTarget(id: string): WatchTarget | null {
  return listTargets().find((t) => t.id === id) ?? null;
}

export function saveTarget(target: WatchTarget): void {
  if (typeof window === "undefined") return;
  const all = listTargets();
  const next = [target, ...all.filter((t) => t.id !== target.id)].slice(
    0,
    MAX_TARGETS,
  );
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // 超出配额时不阻断主流程：只影响盯梢历史
  }
}

export function removeTarget(id: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    KEY,
    JSON.stringify(listTargets().filter((t) => t.id !== id)),
  );
}

export function isWatched(investigationId: string): boolean {
  return listTargets().some((t) => t.investigationId === investigationId);
}
