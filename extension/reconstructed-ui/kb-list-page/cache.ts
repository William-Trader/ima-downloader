import { browser } from '../../lib/env';
import type { CollectResult, KnowledgeItem } from '../../lib/ima/types';

/** 逆向重建：本地知识库结构缓存（storage.local），用于增量更新与「已缓存」标记。 */

export interface KbCache {
  knowledgeBaseId: string;
  collectedAt: number;
  documents: KnowledgeItem[];
  folders: KnowledgeItem[];
  kbUpdateTime?: number;
}

const key = (id: string) => 'kb_cache_' + id;

export async function readCache(knowledgeBaseId: string): Promise<KbCache | null> {
  const stored = await browser.storage.local.get(key(knowledgeBaseId));
  return (stored[key(knowledgeBaseId)] as KbCache) || null;
}

export async function writeCache(knowledgeBaseId: string, result: CollectResult): Promise<KbCache> {
  const cache: KbCache = {
    knowledgeBaseId,
    collectedAt: Date.now(),
    documents: result.documents,
    folders: result.folders,
    kbUpdateTime: result.kbUpdateTime,
  };
  await browser.storage.local.set({ [key(knowledgeBaseId)]: cache });
  return cache;
}

export async function clearAllCaches(): Promise<void> {
  const all = await browser.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith('kb_cache_'));
  if (keys.length) await browser.storage.local.remove(keys);
}

export function relativeTime(ts: number | string, now = Date.now()): string {
  const value = typeof ts === 'string' ? Number(ts) * (String(ts).length <= 10 ? 1000 : 1) : ts;
  const diff = now - value;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return Math.floor(diff / 60_000) + ' 分钟前';
  if (diff < 86400_000) return Math.floor(diff / 3600_000) + ' 小时前';
  return Math.floor(diff / 86400_000) + ' 天前';
}

export function formatSize(size: string | number): string {
  const n = Number(size);
  if (!n) return '0B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return (i === 0 ? v : v.toFixed(1)) + units[i];
}
