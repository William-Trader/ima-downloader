/*!
 * lib/ima/account.ts — ima-downloader 关键下载/授权逻辑
 * © 2026 William-Trader (https://github.com/William-Trader/ima-downloader)
 * WM: IMADL-WM-5B682CBF
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * 依据 PolyForm Noncommercial 1.0.0：仅限非商业用途，禁止任何商业化使用。
 * 本文件含防拷贝水印标记，请勿删除；移除即视为违反许可证。
 */
import { IMA_ACCOUNT_LS_KEY, IMA_VERSION_ATTR, IMA_WEB_VERSION } from './constants';
import type { AccountInfo, ImaHeaders } from './types';

/**
 * 逆向重建：产物的 Q(accountInfo, version) —— IMA 请求头构造。
 * kn 为 token 的 djb2 变体（产物的 Nt）。
 */
export function djb2TokenHash(token: string): number {
  let hash = 5381;
  for (let i = 0; i < token.length; i++) hash += (hash << 5) + token.charCodeAt(i);
  return hash & 2147483647;
}

export function buildImaHeaders(account: AccountInfo, version: string = IMA_WEB_VERSION): ImaHeaders {
  const guidSuffix = account.guid.split('-')[1] || '';
  const token = account.token || '';
  const cookie = [
    'IMA-GUID=' + guidSuffix,
    'IMA-REFRESH-TOKEN=' + account.refreshToken,
    'IMA-TOKEN=' + token,
    'IMA-UID=' + account.uid,
    'UID-TYPE=2',
    'TOKEN-TYPE=14',
    'PLATFORM=H5',
    'CLIENT-TYPE=256020',
    'WEB-VERSION=' + version,
  ].join('; ');
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    from_browser_ima: '1',
    'x-ima-bkn': djb2TokenHash(token).toString(),
    'x-ima-cookie': cookie,
    extension_version: version,
  };
}

/** 页面 localStorage 中读取 accountInfo（content script 环境）。 */
export function readAccountInfoFromPage(): AccountInfo | null {
  const raw = localStorage.getItem(IMA_ACCOUNT_LS_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Partial<AccountInfo>;
  return {
    guid: parsed.guid || '',
    refreshToken: parsed.refreshToken || '',
    token: parsed.token || '',
    uid: parsed.uid || '',
  };
}

/** 读取 main-world 探针写回的 WEB-VERSION，缺省回落到 2.6.15。 */
export function readProbedWebVersion(): string {
  const attr = document.documentElement?.getAttribute(IMA_VERSION_ATTR) || '';
  return /^[0-9A-Za-z._+-]{1,64}$/.test(attr) ? attr : IMA_WEB_VERSION;
}

/** 登录态判定（产物 Te）：code 600001 或文案命中登录过期。 */
export function isLoginExpired(payload: any): boolean {
  if (payload?.code === 600001) return true;
  const text = [payload?.message, payload?.msg, payload?.error, payload?.toast_text].filter(Boolean).join(' ');
  return /登录.*(过期|失效)|token.*(过期|失效|invalid)|鉴权.*(过期|失败|失效)|unauthorized/i.test(text);
}

/** 需要升级客户端（产物 Ae）。 */
export function needsUpgrade(payload: any): boolean {
  const text = [payload?.message, payload?.msg, payload?.error, payload?.toast_text].filter(Boolean).join(' ');
  return /请升级最新版本|升级[^。；;]{0,24}版本|upgrade[^.;]{0,24}version|version[^.;]{0,24}upgrade/i.test(text);
}

/** 从任意嵌套响应里挖出下载直链（产物 P）。 */
export function extractJumpUrl(payload: any): string | undefined {
  const queue = [payload];
  const seen = new Set<any>();
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node || seen.has(node)) continue;
    seen.add(node);
    const url =
      node.jump_url || node.jumpUrl || node.download_url || node.downloadUrl || node.file_url || node.fileUrl || node.jump_url_info?.url;
    if (url) return url;
    if (node.data) queue.push(node.data);
    if (node.result) queue.push(node.result);
  }
  return undefined;
}
