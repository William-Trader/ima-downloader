/*!
 * lib/export.ts — ima-downloader 关键下载/授权逻辑
 * © 2026 William-Trader (https://github.com/William-Trader/ima-downloader)
 * WM: IMADL-WM-0737FB22
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * 依据 PolyForm Noncommercial 1.0.0：仅限非商业用途，禁止任何商业化使用。
 * 本文件含防拷贝水印标记，请勿删除；移除即视为违反许可证。
 */
import { browser } from './env';
import { sanitizeForPlatform } from './filename';
import { MediaType, type KnowledgeItem } from './ima/types';

/** 逆向重建：导出/下载编排（pb 侧调用 background 的 GET_MEDIA_VIA_BACKEND + DOWNLOAD_FILE）。 */

export interface ExportTarget {
  basePath: string;
  item: KnowledgeItem;
  index: number;
  total: number;
}

export interface ExportItemResult {
  mediaId: string;
  title: string;
  ok: boolean;
  error?: string;
  downloadId?: number;
}

export function mediaExt(item: KnowledgeItem): string {
  return '';
}

/** 用正文/笔记结果落盘：微信文章与笔记都返回 data URL，其他返回远程直链。 */
async function downloadOne(basePath: string, item: KnowledgeItem, notebookFormat: 'html' | 'md'): Promise<ExportItemResult> {
  const res: any = await browser.runtime.sendMessage({
    type: 'GET_MEDIA_VIA_BACKEND',
    mediaId: item.media_id,
    knowledgeBaseId: item.parent_folder_id,
    mediaType: item.media_type,
    notebookFormat,
  });
  if (!res?.success) return { mediaId: item.media_id, title: item.title, ok: false, error: res?.error || '获取下载链接失败' };

  const segments = [basePath, item._path, item.title].filter(Boolean).map((s) => s as string);
  let filename = segments.join('/');
  if (res.isWechatArticle) filename += '.html';
  else if (res.isNotebook) filename += notebookFormat === 'html' ? '.html' : '.md';
  else if (res.isUrlText) filename += '.txt';

  const downloaded: any = await browser.runtime.sendMessage({ type: 'DOWNLOAD_FILE', url: res.jump_url, filename });
  if (!downloaded?.success) return { mediaId: item.media_id, title: item.title, ok: false, error: downloaded?.error || '下载失败' };

  // 微信正文/笔记的图片：逐个落盘到同级 img/ 目录
  const images: Array<{ url: string; localPath: string }> = res.wechatImages || res.notebookImages || [];
  for (const image of images) {
    const dir = filename.split('/').slice(0, -1).join('/');
    await browser.runtime.sendMessage({ type: 'DOWNLOAD_FILE', url: image.url, filename: [dir, image.localPath].filter(Boolean).join('/') }).catch(() => null);
  }
  return { mediaId: item.media_id, title: item.title, ok: true, downloadId: downloaded.downloadId };
}

/** 顺序导出（原产物按批次限制并发，避免触发平台风控）。 */
export async function runExport(items: KnowledgeItem[], basePath: string, format: 'html' | 'md', onProgress: (done: number, total: number, latest: ExportItemResult) => void, concurrency = 3) {
  const results: ExportItemResult[] = [];
  const dir = (await sanitizeForPlatform(basePath)) || 'ima-export';
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      const result = await downloadOne(dir, item, format).catch((err) => ({ mediaId: item.media_id, title: item.title, ok: false, error: err instanceof Error ? err.message : String(err) }));
      results.push(result);
      onProgress(results.length, items.length, result);
    }
  });
  await Promise.all(workers);
  return results;
}

export { MediaType };
