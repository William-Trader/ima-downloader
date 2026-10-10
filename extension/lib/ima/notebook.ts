/*!
 * lib/ima/notebook.ts — ima-downloader 关键下载/授权逻辑
 * © 2026 William-Trader (https://github.com/William-Trader/ima-downloader)
 * WM: IMADL-WM-A544B9F3
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * 依据 PolyForm Noncommercial 1.0.0：仅限非商业用途，禁止任何商业化使用。
 * 本文件含防拷贝水印标记，请勿删除；移除即视为违反许可证。
 */
import { EP } from './constants';
import wasmInit, { core_dispatch } from '../../wasm/pkg/ima_export_wasm.js';
import type { ImaHeaders } from './types';

/**
 * 逆向重建：笔记（media_type 6/11）导出链。
 * 产物里 wasm 由 pkg/ima_export_wasm_bg.wasm 通过 `u.runtime.getURL('/wasm/ima_export_wasm_bg.wasm')` 加载，
 * 调用 core_dispatch(op, contentJson, optionsJson)：op=1 -> Markdown，op=2 -> HTML。
 */
let wasmReady: Promise<typeof wasmInit> | null = null;

async function ensureWasm() {
  if (!wasmReady) {
    const runtime = (globalThis as any).browser?.runtime?.id ? (globalThis as any).browser : (globalThis as any).chrome;
    wasmReady = wasmInit({ module_or_path: runtime.runtime.getURL('/wasm/ima_export_wasm_bg.wasm') })
      .then(() => wasmInit)
      .catch((err) => { wasmReady = null; throw err; });
  }
  return wasmReady;
}

async function dispatch(op: number, contentJson: string, options: { title: string; linkMap: Record<string, string> }) {
  await ensureWasm();
  if (typeof core_dispatch !== 'function') throw new Error('当前 WASM 未包含核心调度入口，请重新构建插件');
  return core_dispatch(op, contentJson, JSON.stringify({ title: options.title, linkMap: options.linkMap ?? {} }));
}

export const OP_MARKDOWN = 1;
export const OP_HTML = 2;

export const notebookContentToMdWasm = (contentJson: string, title: string, linkMap: Record<string, string>) => dispatch(OP_MARKDOWN, contentJson, { title, linkMap });
export const notebookContentToHtmlWasm = (contentJson: string, title: string, linkMap: Record<string, string>) => dispatch(OP_HTML, contentJson, { title, linkMap });

/** 从 doc_link / attach_detail 提取 COS key -> 预览图 URL 的映射（产物 ft）。 */
export function buildNotebookLinkMap(doc: any): Record<string, string> | undefined {
  const entries: Array<[string, string]> = [
    ...Object.entries(doc?.doc_link?.link_map ?? {}).filter(([, v]) => typeof v === 'string') as Array<[string, string]>,
    ...Object.values(doc?.doc_info?.attach_detail?.media_details ?? {})
      .map((media: any) => {
        const key = media?.doc_attach_basic?.cos_key;
        const preview = media?.media_preview_url;
        return typeof key === 'string' && typeof preview === 'string' ? ([key, preview] as [string, string]) : null;
      })
      .filter((x): x is [string, string] => x !== null),
  ];
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/**
 * 拉取笔记文档并渲染（产物 kn）。role_type===1 走 get_doc，否则走 get_share_know_doc。
 */
export async function exportNotebook(opts: {
  imaData: any;
  jumpUrl: string;
  headers: ImaHeaders;
  mediaId: string;
  notebookFormat?: 'html' | 'md';
}) {
  const url = new URL(opts.jumpUrl);
  const docId = url.searchParams.get('docid');
  const knowledgeId = url.searchParams.get('knowledgeId');
  if (!docId) return { success: false as const, error: '未从链接解析到 docid', notDeducted: true };
  const isOwner = opts.imaData?.role_type === 1;
  const res = await fetch(isOwner ? EP.notebookGetDoc : EP.notebookGetShareDoc, {
    method: 'POST',
    headers: opts.headers,
    body: JSON.stringify(
      isOwner
        ? { docid: docId, op: { op_basic: true, op_content: true, op_resource: true, op_attach: true, disable_cover: false, op_attach_detail: true } }
        : { docid: docId, knowledge_id: knowledgeId || '', op: { op_basic: true, op_content: true, op_resource: true, op_attach: true, disable_cover: false } },
    ),
  });
  if (!res.ok) return { success: false as const, error: '笔记接口 HTTP ' + res.status, notDeducted: true };
  const doc = await res.json();
  const content = doc?.doc_info?.content_info?.content_info?.content;
  if (!content) return { success: false as const, error: '未获取到笔记内容', notDeducted: true };
  const title = doc?.doc_info?.basic_info?.basic_info?.title || '笔记';
  const linkMap = buildNotebookLinkMap(doc);
  const { localPathMap, images } = collectNotebookImages(content, linkMap);
  const effectiveMap = images.length > 0 ? localPathMap : linkMap;
  const html = opts.notebookFormat === 'html'
    ? await notebookContentToHtmlWasm(content, title, effectiveMap as Record<string, string>)
    : await notebookContentToMdWasm(content, title, effectiveMap as Record<string, string>);
  return {
    success: true as const,
    content: html,
    mime: opts.notebookFormat === 'html' ? 'text/html' : 'text/markdown',
    title,
    images,
    linkMap: effectiveMap,
  };
}

/** 遍历笔记内容树收集 cloud_image 图片（产物 dn）。 */
export function collectNotebookImages(contentJson: string, urlMap?: Record<string, string>) {
  const localPathMap: Record<string, string> = {};
  const images: Array<{ url: string; localPath: string }> = [];
  const seen = new Set<string>();
  let tree: any[] | null = null;
  try { const parsed = JSON.parse(contentJson); tree = Array.isArray(parsed) ? parsed : null; } catch { tree = null; }
  if (!tree) return { localPathMap, images };
  const walk = (nodes: any[]) => {
    for (const node of nodes) {
      if (node.type === 'cloud_image' && node.url && /^https?:\/\//.test(node.url)) {
        const key = node.url.split('?')[0];
        if (!seen.has(key)) {
          seen.add(key);
          let filename = 'image_' + seen.size + '.webp';
          try { const parts = new URL(key).pathname.split('/'); filename = parts[parts.length - 1] || filename; } catch { /* keep default */ }
          const localPath = 'img/' + filename;
          localPathMap[key] = localPath;
          images.push({ url: urlMap?.[node.url] || urlMap?.[key] || node.url, localPath });
        }
      }
      if (Array.isArray(node.children)) walk(node.children);
    }
  };
  for (const root of tree) if (Array.isArray(root.children)) walk(root.children);
  return { localPathMap, images };
}
