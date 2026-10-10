/*!
 * lib/ima/api.ts — ima-downloader 关键下载/授权逻辑
 * © 2026 William-Trader (https://github.com/William-Trader/ima-downloader)
 * WM: IMADL-WM-451A5C82
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * 依据 PolyForm Noncommercial 1.0.0：仅限非商业用途，禁止任何商业化使用。
 * 本文件含防拷贝水印标记，请勿删除；移除即视为违反许可证。
 */
import { EP, IMA_WEB_VERSION } from './constants';
import { extractJumpUrl, isLoginExpired, needsUpgrade } from './account';
import { secureGetMedia } from './crypto';
import type { AccountInfo, ImaHeaders, KnowledgeBase, KnowledgeItem } from './types';

/** 逆向重建：知识库列表（ur 模块：he/Ze/or/ar/sr/ir/cr）。 */

function mapKnowledgeBase(type: string, raw: any): KnowledgeBase {
  return {
    id: raw.id,
    name: raw.basic_info?.name || '',
    type,
    member_count: raw.member_info?.member_count || 0,
    cover_url: raw.basic_info?.cover_url || '',
    size: raw.basic_info?.size || '0',
    description: raw.basic_info?.description || '',
    update_time: raw.basic_info?.update_timestamp_sec || '0',
    status_toast: raw.knowledge_base_status_toast || '',
    access_status: raw.permission_info?.access_status ?? 0,
    creator_name: raw.basic_info?.creator?.nickname || '',
    creator_avatar: raw.basic_info?.creator?.avatar_url || '',
    file_count: 0,
  };
}

function pendingPage(result: any) {
  return { type: result.type, cursor: String(result.knowledge_base_list?.length || 10) };
}

async function fetchHomePageData(headers: ImaHeaders, knowledgeBaseId: string) {
  return (
    await fetch(EP.getHomePageData, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        need_folder_number: true,
        knowledge_list_req: { knowledge_base_id: knowledgeBaseId, need_default_cover: false, sort_type: 0, limit: 50, cursor: '' },
        knowledge_base_id: knowledgeBaseId,
      }),
    })
  ).json();
}

async function fetchRemainingPages(headers: ImaHeaders, acc: KnowledgeBase[], pending: Array<{ type: string; cursor: string }>) {
  for (const page of pending) {
    let cursor = page.cursor;
    let done = false;
    while (!done) {
      const res = await (
        await fetch(EP.getKnowledgeBaseList, {
          method: 'POST',
          headers,
          body: JSON.stringify({ params: [{ type: page.type, cursor, limit: 10 }] }),
        })
      ).json();
      for (const group of res.results || []) {
        for (const kb of group.knowledge_base_list || []) acc.push(mapKnowledgeBase(group.type, kb));
        done = group.is_end !== false;
        if (!done) {
          cursor = group.next_cursor || String(acc.filter((k) => k.type === page.type).length);
          if (!cursor) done = true;
        }
      }
      if (!res.results?.length) done = true;
    }
  }
}

async function countFiles(headers: ImaHeaders, knowledgeBaseId: string): Promise<number> {
  const res = await (
    await fetch(EP.getKnowledgeList, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        knowledge_base_id: knowledgeBaseId,
        parent_folder_id: knowledgeBaseId,
        need_default_cover: false,
        sort_type: 0,
        limit: 1,
        cursor: '',
        need_folder_number: true,
      }),
    })
  ).json();
  return parseInt(res.total_size || '0', 10);
}

/** 并发 6 路补齐每个知识库的文件数。 */
async function fillFileCounts(headers: ImaHeaders, list: KnowledgeBase[]) {
  for (let i = 0; i < list.length; i += 6) {
    const slice = list.slice(i, i + 6);
    const counts = await Promise.all(slice.map(async (kb) => { try { return await countFiles(headers, kb.id); } catch { return 0; } }));
    for (let j = 0; j < counts.length; j++) list[i + j].file_count = counts[j];
    if (i + 6 < list.length) await new Promise((r) => setTimeout(r, 100));
  }
}

export async function fetchKnowledgeBaseList(headers: ImaHeaders, uid: string): Promise<KnowledgeBase[]> {
  const home = await fetchHomePageData(headers, uid);
  const acc: KnowledgeBase[] = [];
  const pending: Array<{ type: string; cursor: string }> = [];
  for (const group of home.results || []) {
    for (const kb of group.knowledge_base_list || []) acc.push(mapKnowledgeBase(group.type, kb));
    if (!group.is_end) pending.push(pendingPage(group));
  }
  await fetchRemainingPages(headers, acc, pending);
  await fillFileCounts(headers, acc);
  return acc;
}

/** 取文件夹一页（Mn -> Mt）。 */
export async function fetchFolderPage(headers: ImaHeaders, knowledgeBaseId: string, folderId: string, parentPath = '', cursor = '') {
  const res = await fetch(EP.getKnowledgeList, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      sort_type: 9,
      need_default_cover: true,
      knowledge_base_id: knowledgeBaseId,
      folder_id: folderId,
      cursor,
      limit: 50,
      version: '',
      ext_info: {},
    }),
  });
  if (!res.ok) throw new Error('获取文件夹失败（HTTP ' + res.status + '）');
  const json = await res.json();
  if (json.code !== undefined && json.code !== 0) throw new Error('获取文件夹失败（code ' + json.code + '）');
  return {
    folders: (json.knowledge_list || []).filter((n: any) => !!n.folder_info).map((n: any) => mapItem(n, parentPath)),
    isEnd: json.is_end !== false,
    nextCursor: json.next_cursor || '',
  };
}

/** 列表项映射（产物 Pe）。 */
export function mapItem(raw: any, parentPath: string): KnowledgeItem {
  return {
    title: raw.title,
    media_id: raw.media_id,
    media_type: raw.media_type,
    file_size: raw.file_size,
    create_time: raw.create_time,
    update_time: raw.update_time,
    parent_folder_id: raw.parent_folder_id,
    folder_info: raw.folder_info,
    access_status: raw.access_status ?? 0,
    _path: parentPath,
  };
}

/**
 * get_media 三级回退链（产物 Z）：
 * 1) 安全加密接口 /cgi-bin/s/file_manager/get_media
 * 2) 明文接口（带 knowledge_base_id，再退化为仅 media_id）
 * 3) 知识详情接口 /get_knowledge
 */
export async function getMedia(headers: ImaHeaders, mediaId: string, knowledgeBaseId?: string) {
  const payload: Record<string, unknown> = { media_id: mediaId };
  if (knowledgeBaseId) {
    payload.knowledge_base_id = knowledgeBaseId;
    payload.knowledge_id = knowledgeBaseId;
  }
  let data: any;
  try {
    data = await secureGetMedia(headers as unknown as Record<string, string>, payload, EP.getMedia);
    if (extractJumpUrl(data)) return data;
  } catch (err) {
    console.error('[IMA get_media] 安全接口失败，回退明文接口', err);
  }
  const plain = async (body: unknown) => {
    const res = await fetch(EP.getMediaPlain, { method: 'POST', headers, credentials: 'include', body: JSON.stringify(body) });
    return res.json();
  };
  data = await plain(payload);
  if (!extractJumpUrl(data) && knowledgeBaseId) data = await plain({ media_id: mediaId });
  if (!extractJumpUrl(data) && knowledgeBaseId) {
    try {
      const res = await fetch(EP.getKnowledge, {
        method: 'POST',
        headers,
        body: JSON.stringify({ knowledge_base_id: knowledgeBaseId, media_id: mediaId, need_default_cover: false }),
      });
      const json = await res.json();
      const mapped = mapKnowledgeDetail(json);
      if (mapped) return mapped;
    } catch (err) {
      console.error('[IMA get_media] 知识详情回退接口失败', err);
    }
  }
  return data;
}

/** 知识详情回退的映射（产物 dt）。 */
function mapKnowledgeDetail(payload: any) {
  const knowledge = payload.knowledge;
  if (payload.code !== 0 || !knowledge) return null;
  const jump = typeof knowledge.jump_url === 'string' ? knowledge.jump_url : knowledge.jump_url?.url;
  if (!jump) return null;
  return {
    code: payload.code,
    msg: payload.msg,
    jump_url: jump,
    source_path: knowledge.source_path || knowledge.raw_file_url || '',
    file_size: knowledge.file_size || '0',
    title: knowledge.title || '',
    role_type: knowledge.access_status === 3 ? 1 : 0,
  };
}

export { isLoginExpired, needsUpgrade, extractJumpUrl };
export const WEB_VERSION = IMA_WEB_VERSION;
export type { AccountInfo };
