/*!
 * lib/ima/collector.ts — ima-downloader 关键下载/授权逻辑
 * © 2026 William-Trader (https://github.com/William-Trader/ima-downloader)
 * WM: IMADL-WM-B4C7443E
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * 依据 PolyForm Noncommercial 1.0.0：仅限非商业用途，禁止任何商业化使用。
 * 本文件含防拷贝水印标记，请勿删除；移除即视为违反许可证。
 */
import { EP } from './constants';
import { mapItem } from './api';
import type { CollectResult, ImaHeaders, IncrementalInput, KnowledgeItem } from './types';

/** 逆向重建：collectKnowledgeInBg（产物 mn/$e/Rt/$t/vt/Pt）—— BFS 全量 + 增量采集。 */

const BATCH_SIZE = 5;

interface QueueEntry { folderId: string; parentPath: string; updateTime?: string }

function isOldFolder(entry: { folderId: string; knowledgeBaseId: string; updateTime?: string; stopBeforeTs?: number }): boolean {
  const { folderId, knowledgeBaseId, updateTime, stopBeforeTs } = entry;
  if (folderId === knowledgeBaseId || !updateTime || stopBeforeTs === undefined) return false;
  return Number(updateTime) <= stopBeforeTs;
}

/** 分页取文件夹内容（产物 $e），支持增量早期终止。 */
async function fetchFolderContents(headers: ImaHeaders, knowledgeBaseId: string, folderId: string, sortType: number, onProgress: (n: number) => void, stopBeforeTs?: number) {
  const items: KnowledgeItem[] = [];
  let cursor = '';
  let done = false;
  let page = 0;
  let stoppedEarly = false;
  const seen = new Set<string>();
  while (!done) {
    page++;
    const json = await (
      await fetch(EP.getKnowledgeList, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          sort_type: sortType,
          need_default_cover: true,
          knowledge_base_id: knowledgeBaseId,
          folder_id: folderId,
          cursor,
          limit: 50,
          version: '',
          ext_info: {},
        }),
      })
    ).json();
    const list: any[] = json.knowledge_list || [];
    if (list.length) {
      const docs = list.filter((x) => !x.folder_info);
      const folders = list.filter((x) => !!x.folder_info);
      // 增量：本页文档全是旧数据 -> 保留文件夹后提前结束
      const allOld = docs.length > 0 && docs.every((d) => Number(d.update_time) <= (stopBeforeTs ?? -Infinity));
      items.push(...(stopBeforeTs === undefined ? list : allOld ? folders : list));
      if (stopBeforeTs !== undefined && allOld) {
        stoppedEarly = true;
        console.error('[fetchFolderContents] 第' + page + '页: 增量早期终止');
        break;
      }
      if (docs.length) onProgress(docs.length);
    }
    done = json.is_end !== false;
    if (!done) {
      const next = json.next_cursor || '';
      if (!next || seen.has(next)) done = true;
      else { seen.add(next); cursor = next; }
    }
  }
  return { items, stoppedEarly };
}

function cachedResult(input: IncrementalInput, kbUpdateTime?: number): CollectResult {
  return {
    folders: input.cachedFolders,
    documents: input.cachedDocuments,
    totalFolders: input.cachedFolders.length,
    totalDocuments: input.cachedDocuments.length,
    kbUpdateTime,
    incrementalStats: {
      newCount: 0, updatedCount: 0, skippedFolders: 0, latestUpdateTime: '',
      previousTotal: input.cachedDocuments.length, currentTotal: input.cachedDocuments.length, noChange: true,
    },
  };
}

/** 增量合并（产物 vt）。 */
function mergeIncremental(collected: KnowledgeItem[], collectedFolders: KnowledgeItem[], cached: IncrementalInput, skippedFolders: number) {
  const seenDocs = new Set(cached.cachedDocuments.map((d) => d.media_id));
  const docMap = new Map(cached.cachedDocuments.map((d) => [d.media_id, d] as const));
  let newCount = 0, updatedCount = 0, latest = '';
  for (const doc of collected) {
    if (!seenDocs.has(doc.media_id)) newCount++;
    else {
      const prev = docMap.get(doc.media_id);
      if (prev && doc.update_time !== prev.update_time) updatedCount++;
    }
    if (!latest || doc.update_time > latest) latest = doc.update_time;
    docMap.set(doc.media_id, doc);
  }
  const folderMap = new Map(cached.cachedFolders.map((f) => [f.media_id, f] as const));
  for (const f of collectedFolders) folderMap.set(f.media_id, f);
  const documents = Array.from(docMap.values());
  return {
    folders: Array.from(folderMap.values()),
    documents,
    incrementalStats: {
      newCount, updatedCount, skippedFolders, latestUpdateTime: latest,
      previousTotal: cached.cachedDocuments.length, currentTotal: documents.length,
    },
  };
}

export async function collectKnowledgeInBg(
  headers: ImaHeaders,
  knowledgeBaseId: string,
  onProgress?: (collected: number) => void,
  incremental?: IncrementalInput,
  scope?: { folderId: string; folderPath?: string },
): Promise<CollectResult> {
  const foldersOut: KnowledgeItem[] = [];
  const docsOut: KnowledgeItem[] = [];
  const queue: QueueEntry[] = [];
  let collected = 0, skippedFolders = 0;
  let kbUpdateTime: number | undefined;
  const isIncremental = !!incremental;
  const sortType = isIncremental ? 9 : 0;
  const stopBeforeTs = incremental?.lastCollectedAt;

  const accept = (raw: any, parentPath: string): { isFolder: boolean } => {
    const isFolder = !!raw.folder_info;
    const item = mapItem(raw, parentPath);
    if (isFolder) {
      foldersOut.push(item);
      const folderId = raw.folder_info?.folder_id || raw.media_id;
      const path = parentPath ? parentPath + '/' + raw.title : raw.title;
      queue.push({ folderId, parentPath: path, updateTime: raw.update_time });
      return { isFolder: true };
    }
    docsOut.push(item);
    return { isFolder: false };
  };

  if (isIncremental && stopBeforeTs && !scope) {
    try {
      const home = await (
        await fetch(EP.getKnowledgeBaseHomePage, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            knowledge_base_id: knowledgeBaseId,
            knowledge_list_req: { knowledge_base_id: knowledgeBaseId, folder_id: knowledgeBaseId, sort_type: 9, need_default_cover: true, version: '' },
          }),
        })
      ).json();
      if (home.code === 0) {
        const ts = Number(home.list_rsp?.knowledge_base_info?.basic_info?.update_timestamp_sec || 0);
        if (ts > 0) kbUpdateTime = ts;
        // 快速跳过：KB 更新时间不晚于上次采集
        if (ts > 0 && ts <= stopBeforeTs) return cachedResult(incremental, kbUpdateTime);
        for (const raw of home.list_rsp?.knowledge_list || []) accept(raw, '');
        if (!home.list_rsp?.is_end && home.list_rsp?.next_cursor) {
          const tail = await fetchFolderContents(headers, knowledgeBaseId, knowledgeBaseId, sortType, (n) => { collected += n; onProgress?.(collected); }, stopBeforeTs);
          for (const raw of tail.items) {
            const dup = raw.folder_info ? foldersOut.some((x) => x.media_id === raw.media_id) : docsOut.some((x) => x.media_id === raw.media_id);
            if (!dup) accept(raw, '');
          }
        }
        collected = docsOut.length;
        onProgress?.(collected);
      } else {
        queue.push({ folderId: knowledgeBaseId, parentPath: '' });
      }
    } catch (err) {
      console.error('[增量] home_page 请求异常，回退标准 BFS', err);
      queue.push({ folderId: knowledgeBaseId, parentPath: '' });
    }
  } else {
    queue.push({ folderId: scope?.folderId || knowledgeBaseId, parentPath: scope?.folderPath || '' });
  }

  while (queue.length > 0) {
    const batch = queue.splice(0, Math.min(BATCH_SIZE, queue.length));
    const runnable = isIncremental
      ? batch.filter((e) => {
          if (isOldFolder({ folderId: e.folderId, knowledgeBaseId, updateTime: e.updateTime, stopBeforeTs })) {
            skippedFolders++;
            return false;
          }
          return true;
        })
      : batch;
    if (!runnable.length) continue;
    const results = await Promise.all(
      runnable.map(({ folderId, parentPath }) =>
        fetchFolderContents(headers, knowledgeBaseId, folderId, sortType, (n) => { collected += n; onProgress?.(collected); }, stopBeforeTs)
          .then((r) => ({ items: r.items, parentPath }))
          .catch((err) => ({ items: [] as KnowledgeItem[], parentPath, error: err as Error })),
      ),
    );
    for (const { items, parentPath } of results) for (const raw of items) accept(raw, parentPath);
    onProgress?.(docsOut.length);
  }

  if (isIncremental && incremental) {
    const merged = mergeIncremental(docsOut, foldersOut, incremental, skippedFolders);
    return { ...merged, totalFolders: merged.folders.length, totalDocuments: merged.documents.length, kbUpdateTime };
  }
  return { folders: foldersOut, documents: docsOut, totalFolders: foldersOut.length, totalDocuments: docsOut.length, kbUpdateTime };
}
