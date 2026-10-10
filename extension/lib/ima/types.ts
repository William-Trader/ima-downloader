/*!
 * lib/ima/types.ts — ima-downloader 关键下载/授权逻辑
 * © 2026 William-Trader (https://github.com/William-Trader/ima-downloader)
 * WM: IMADL-WM-384BB8C8
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * 依据 PolyForm Noncommercial 1.0.0：仅限非商业用途，禁止任何商业化使用。
 * 本文件含防拷贝水印标记，请勿删除；移除即视为违反许可证。
 */
export interface AccountInfo {
  guid: string;
  token: string;
  refreshToken: string;
  uid: string;
}

export interface ImaHeaders {
  Accept: string;
  'Content-Type': string;
  from_browser_ima: string;
  'x-ima-bkn': string;
  'x-ima-cookie': string;
  extension_version: string;
}

export interface KnowledgeBase {
  id: string;
  name: string;
  type: string;
  member_count: number;
  cover_url: string;
  size: string;
  description: string;
  update_time: string;
  status_toast: string;
  access_status: number;
  creator_name: string;
  creator_avatar: string;
  file_count: number;
}

export interface KnowledgeItem {
  title: string;
  media_id: string;
  media_type: number;
  file_size: string;
  create_time: string;
  update_time: string;
  parent_folder_id: string;
  folder_info?: { folder_id?: string } & Record<string, unknown>;
  access_status: number;
  _path: string;
}

/** 媒体类型（产物中的分支判断）。 */
export const MediaType = {
  /** 普通文件：直接给下载链接 */
  FILE: 0,
  /** 微信文章：走 offscreen 抓正文内嵌 */
  WECHAT_ARTICLE: 2,
  /** 笔记本/笔记：文档接口 + wasm 渲染 html/md */
  NOTEBOOK: 6,
  /** 笔记（另一类型码） */
  NOTEBOOK_ALT: 11,
} as const;
