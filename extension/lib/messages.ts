/*!
 * lib/messages.ts — ima-downloader 关键下载/授权逻辑
 * © 2026 William-Trader (https://github.com/William-Trader/ima-downloader)
 * WM: IMADL-WM-1B32AA18
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * 依据 PolyForm Noncommercial 1.0.0：仅限非商业用途，禁止任何商业化使用。
 * 本文件含防拷贝水印标记，请勿删除；移除即视为违反许可证。
 */
import type { AccountInfo, KnowledgeBase, KnowledgeItem } from './ima/types';

/** 逆向重建：background 中 runtime.onMessage 分发的全部消息类型（逐字取自产物）。 */
export type BgRequest =
  | { type: 'OPEN_AUTH_PAGE' }
  | { type: 'START_EXPORT' }
  | { type: 'SET_ACTIVE_IMA_TAB'; tabId: number }
  | { type: 'GET_ACCOUNT_INFO' }
  | { type: 'GET_MEDIA'; mediaId: string; knowledgeBaseId?: string }
  | { type: 'CHECK_QUOTA' }
  | { type: 'GET_MEDIA_VIA_BACKEND'; mediaId: string; knowledgeBaseId?: string; mediaType?: number; notebookFormat?: 'html' | 'md' }
  | { type: 'COLLECT_KNOWLEDGE_VIA_BG'; knowledgeBaseId: string; fileCount?: number; incremental?: IncrementalInput; folderScope?: FolderScope }
  | { type: 'GET_KNOWLEDGE_BASE_LIST' }
  | { type: 'GET_KNOWLEDGE_FOLDER_PAGE'; knowledgeBaseId: string; parentFolderId: string; parentPath?: string; cursor?: string }
  | { type: 'DOWNLOAD_FILE'; url: string; filename: string }
  | { type: 'FETCH_DOWNLOAD_CONTENT'; url: string };

/** content script 侧消息。 */
export type CsRequest =
  | { type: 'SHOW_IMA_LOGIN_HINT' }
  | { type: 'GET_ACCOUNT_INFO' }
  | { type: 'GET_MEDIA'; mediaId: string; knowledgeBaseId?: string };

export type BgResponse<T = unknown> = { success: true; data: T } | { success: false; error: string; authExpired?: boolean; imaLoginExpired?: boolean; rateLimit?: boolean; needImaLogin?: boolean; imaTabId?: number };

export interface IncrementalInput {
  lastCollectedAt: number;
  cachedDocuments: KnowledgeItem[];
  cachedFolders: KnowledgeItem[];
}

export interface FolderScope {
  folderId: string;
  folderPath?: string;
}

export interface IncrementalStats {
  newCount: number;
  updatedCount: number;
  skippedFolders: number;
  latestUpdateTime: string;
  previousTotal: number;
  currentTotal: number;
  noChange?: boolean;
}

export interface CollectResult {
  folders: KnowledgeItem[];
  documents: KnowledgeItem[];
  totalFolders: number;
  totalDocuments: number;
  incrementalStats?: IncrementalStats;
  kbUpdateTime?: number;
}

export type { AccountInfo, KnowledgeBase, KnowledgeItem };
