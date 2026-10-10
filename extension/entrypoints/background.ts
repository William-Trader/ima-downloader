/*!
 * entrypoints/background.ts — ima-downloader 关键下载/授权逻辑
 * © 2026 William-Trader (https://github.com/William-Trader/ima-downloader)
 * WM: IMADL-WM-37A2A3A3
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * 依据 PolyForm Noncommercial 1.0.0：仅限非商业用途，禁止任何商业化使用。
 * 本文件含防拷贝水印标记，请勿删除；移除即视为违反许可证。
 */
import { browser } from '../lib/env';
import { buildImaHeaders, extractJumpUrl, isLoginExpired, needsUpgrade, readProbedWebVersion } from '../lib/ima/account';
import { fetchKnowledgeBaseList, fetchFolderPage, getMedia } from '../lib/ima/api';
import { collectKnowledgeInBg } from '../lib/ima/collector';
import { exportNotebook } from '../lib/ima/notebook';
import { dataUrlToBytes, textToDataUrl } from '../lib/ima/crypto';
import { WECHAT_PENDING_PREFIX } from '../lib/ima/constants';
import { fetchAndEmbedWechatArticle } from '../lib/offscreen';
import { normalizeFilename, normalizeRelativePath } from '../lib/filename';
import { checkQuota, heartbeat, activate, deactivate, consumeQuota, ensureRegistered, getToken, getDeviceId, DIRECT_MODE_BUILD } from '../lib/license';

/** 逆向重建：background service worker（产物 background.js 的 xn.main()）。 */

const ACTIVE_TAB_KEY = 'activeImaTabId';
const TOKEN_WAIT_MS = 8000;
const TOKEN_POLL_MS = 500;
const DOWNLOAD_STALL_MS = 30000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---------- 专用 IMA 页面管理 ---------- */

async function bindActiveTab(tabId: number) { await browser.storage.local.set({ [ACTIVE_TAB_KEY]: tabId }); }
async function clearActiveTab() { await browser.storage.local.remove(ACTIVE_TAB_KEY); }

async function getActiveImaTab() {
  const cached = (await browser.storage.local.get(ACTIVE_TAB_KEY))[ACTIVE_TAB_KEY];
  if (typeof cached === 'number') {
    const tab = await browser.tabs.get(cached).catch(() => null);
    if (tab && tab.url?.includes('ima.qq.com')) return tab;
    await clearActiveTab();
  }
  return createImaTab();
}

async function createImaTab() {
  const tab = await browser.tabs.create({ url: 'https://ima.qq.com', active: false });
  if (!tab.id) return null;
  await waitForTabComplete(tab.id);
  await sleep(1000);
  await bindActiveTab(tab.id);
  console.error('[IMA Tab] 自动创建专用页面 tab=' + tab.id);
  return tab;
}

async function waitForTabComplete(tabId: number, timeout = 15000): Promise<void> {
  const tab = await browser.tabs.get(tabId).catch(() => null);
  if (!tab) throw new Error('IMA 页面已关闭，请重新打开后再试');
  if (tab.status === 'complete') return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('等待 IMA 页面加载超时，请稍后重试')); }, timeout);
    const cleanup = () => { clearTimeout(timer); browser.tabs.onUpdated.removeListener(onUpdated); browser.tabs.onRemoved.removeListener(onRemoved); };
    const onUpdated = (id: number, info: chrome.tabs.TabChangeInfo) => { if (id === tabId && info.status === 'complete') { cleanup(); resolve(); } };
    const onRemoved = (id: number) => { if (id === tabId) { cleanup(); reject(new Error('IMA 页面已关闭，请重新打开后再试')); } };
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs.onRemoved.addListener(onRemoved);
  });
}

const RECEIVER_MISSING = 'Receiving end does not exist';
const isReceiverMissing = (err: unknown) => (err instanceof Error ? err.message : String(err || '')).includes(RECEIVER_MISSING);

/** 带“刷新页面重试一次”的 tabs.sendMessage（产物 x/Ke）。 */
async function sendToTab<T = any>(tabId: number, message: unknown): Promise<T> {
  await waitForTabComplete(tabId);
  try {
    return (await browser.tabs.sendMessage(tabId, message)) as T;
  } catch (err) {
    if (!isReceiverMissing(err)) throw err;
    console.error('[通信修复] content script 接收端不存在，刷新 tab=' + tabId);
    await browser.tabs.reload(tabId);
    await waitForTabComplete(tabId);
    await sleep(800);
    try {
      return (await browser.tabs.sendMessage(tabId, message)) as T;
    } catch (retryErr) {
      if (isReceiverMissing(retryErr)) throw new Error('IMA 页面通信失败，已自动刷新一次页面，请稍后重试');
      throw retryErr;
    }
  }
}

const ok = (res: any) => res?.success === true && !!res.data;

async function getAccountAndHeaders(tabId: number) {
  const res = await sendToTab(tabId, { type: 'GET_ACCOUNT_INFO' });
  if (!ok(res)) throw new Error(res?.error || '获取账号信息失败');
  return { accountInfo: res.data, headers: buildImaHeaders(res.data, await probeVersion(tabId)) };
}

/** 读 main-world 探针写进 DOM 的 WEB-VERSION（产物 $n 的 r()）。 */
async function probeVersion(tabId: number): Promise<string> {
  try {
    const [injection] = await browser.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: (attr: string) => document.documentElement?.getAttribute(attr) || '',
      args: ['data-ima-export-web-version'],
    });
    const value = injection?.result;
    return typeof value === 'string' && /^[0-9A-Za-z._+-]{1,64}$/.test(value) ? value : '2.6.15';
  } catch {
    return '2.6.15';
  }
}

/* ---------- 消息处理 ---------- */

async function openAuthPage() {
  await browser.tabs.create({ url: browser.runtime.getURL('/auth-page.html') });
  return { success: true };
}

async function startExport() {
  const tab = await getActiveImaTab();
  if (!tab?.id) return { success: false, error: '无法创建 IMA 页面' };
  const res = await sendToTab(tab.id, { type: 'GET_ACCOUNT_INFO' });
  if (ok(res)) return { success: true };
  await showImaLoginHint(tab.id);
  return { success: false, needImaLogin: true, imaTabId: tab.id };
}

async function showImaLoginHint(tabId: number) {
  try { await sendToTab(tabId, { type: 'SHOW_IMA_LOGIN_HINT' }); } catch (err) { console.error('[IMA Login] 注入登录提示失败', err); }
}

async function setActiveImaTab(req: { tabId: number }) {
  const tabId = Number(req.tabId);
  if (!tabId) return { success: false, error: '无效的 IMA 页面 tabId' };
  const tab = await browser.tabs.get(tabId).catch(() => null);
  if (!tab?.id || !tab.url?.includes('ima.qq.com')) return { success: false, error: 'IMA 页面不存在或地址不正确' };
  await bindActiveTab(tab.id);
  return { success: true };
}

async function forwardToActiveTab(req: unknown) {
  const tab = await getActiveImaTab();
  if (!tab?.id) return { success: false, error: '请重新从插件弹窗开始导出，系统需要先创建本次导出专用的 IMA 页面' };
  return sendToTab(tab.id, req);
}

async function handleCheckQuota() {
  return { success: true, data: await checkQuota() };
}

/** 授权：查询当前状态（含是否已激活）。 */
async function handleLicenseStatus() {
  const info = await checkQuota();
  const token = await getToken();
  return { success: true, data: { ...info, activated: Boolean(token), device_id: await getDeviceId() } };
}

/** 授权：卡密激活。 */
async function handleLicenseActivate(code: string) {
  const result = await activate(code);
  return { success: true, data: result };
}

/**
 * 取媒体 + 生成导出结果（产物 $n/Nn）。
 * 登录过期时刷新 IMA 页面并等待 token 变化后重试一次。
 */
async function fetchMediaAndResolve(tabId: number, mediaId: string, knowledgeBaseId?: string) {
  let account = await getAccountAndHeaders(tabId);
  let data = await getMedia(account.headers, mediaId, knowledgeBaseId);
  if (!extractJumpUrl(data) && needsUpgrade(data)) {
    await sleep(125);
    account = await getAccountAndHeaders(tabId);
    data = await getMedia(account.headers, mediaId, knowledgeBaseId);
  }
  if (!isLoginExpired(data)) return { ok: true as const, ...account, imaData: data };

  console.error('[IMA] 登录过期，自动刷新 IMA 页面重试');
  const oldToken = account.accountInfo.token;
  let retryTabId = tabId;
  try {
    await browser.tabs.reload(tabId);
    await waitForTabComplete(tabId);
    await sleep(800);
  } catch (err) {
    console.error('[IMA] 刷新当前页面失败，尝试新建 IMA 页面', err);
    await clearActiveTab();
    const fresh = await createImaTab();
    if (!fresh?.id) return { ok: false as const, response: { success: false, error: 'IMA 登录过期，自动刷新失败，请手动登录 ima.qq.com 后重试', imaLoginExpired: true } };
    retryTabId = fresh.id;
  }
  const refreshed = await waitForTokenChange(retryTabId, oldToken);
  if (!ok(refreshed)) return { ok: false as const, response: { success: false, error: 'IMA 登录过期，刷新后仍无法获取登录信息，请手动登录 ima.qq.com 后重试', imaLoginExpired: true } };
  let headers = buildImaHeaders(refreshed.data, await probeVersion(retryTabId));
  data = await getMedia(headers, mediaId, knowledgeBaseId);
  if (!extractJumpUrl(data) && needsUpgrade(data)) {
    await sleep(125);
    headers = buildImaHeaders(refreshed.data, await probeVersion(retryTabId));
    data = await getMedia(headers, mediaId, knowledgeBaseId);
  }
  if (isLoginExpired(data)) return { ok: false as const, response: { success: false, error: 'IMA 登录过期，请手动登录 ima.qq.com 后重试', imaLoginExpired: true } };
  return { ok: true as const, accountInfo: refreshed.data, headers, imaData: data };
}

/** 轮询等待 token 变化（产物 Pn）。 */
async function waitForTokenChange(tabId: number, oldToken: string) {
  const deadline = Date.now() + TOKEN_WAIT_MS;
  let last: any;
  while (Date.now() < deadline) {
    last = await sendToTab(tabId, { type: 'GET_ACCOUNT_INFO' });
    if (ok(last) && last.data.token && last.data.token !== oldToken) return last;
    await sleep(TOKEN_POLL_MS);
  }
  return last ?? (await sendToTab(tabId, { type: 'GET_ACCOUNT_INFO' }));
}

/** 微信正文/图片占位队列（产物 q/B）。 */
const wechatBodies = new Map<string, string>();
const wechatImages = new Map<string, { base64: string; mimeType: string }>();

async function getMediaViaBackend(req: { mediaId: string; knowledgeBaseId?: string; mediaType?: number; notebookFormat?: 'html' | 'md' }) {
  const tab = await getActiveImaTab();
  if (!tab?.id) return { success: false, error: '请重新从插件弹窗开始导出，系统需要先创建本次导出专用的 IMA 页面' };
  const resolved = await fetchMediaAndResolve(tab.id, req.mediaId, req.knowledgeBaseId);
  if (!resolved.ok) return resolved.response;
  const jumpUrl = extractJumpUrl(resolved.imaData);
  if (!jumpUrl) return { success: false, error: '未获取到下载链接', notDeducted: true, data: resolved.imaData };
  let quotaRemaining = 9999;
  if (!DIRECT_MODE_BUILD) {
    try {
      quotaRemaining = await consumeQuota(1);
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : '授权校验失败', quotaExceeded: true };
    }
  }

  if (req.mediaType === 2) {
    // 微信文章 -> offscreen 抓正文
    return wrapWechatArticle(resolved.imaData, jumpUrl, quotaRemaining);
  }
  if (req.mediaType === 11) {
    const result = await exportNotebook({ imaData: resolved.imaData, jumpUrl, headers: resolved.headers, mediaId: req.mediaId, notebookFormat: req.notebookFormat });
    if (!result.success) return { success: false, error: result.error, notDeducted: true };
    const dataUrl = textToDataUrl(result.content, result.mime);
    return { success: true, data: resolved.imaData, jump_url: dataUrl, quota_remaining: quotaRemaining, isNotebook: true, notebookImages: 'images' in result ? result.images : [] };
  }
  return { success: true, data: resolved.imaData, jump_url: jumpUrl, quota_remaining: quotaRemaining };
}

async function wrapWechatArticle(imaData: any, url: string, quotaRemaining: number) {
  try {
    const article = await fetchAndEmbedWechatArticle(url);
    const token = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    wechatBodies.set(token, article.contentHtml);
    const images = article.images.map((img, index) => {
      const key = token + '_image_' + index;
      wechatImages.set(key, { base64: img.base64, mimeType: img.mimeType });
      return { url: WECHAT_PENDING_PREFIX + key, localPath: img.localPath };
    });
    return { success: true, data: imaData, jump_url: WECHAT_PENDING_PREFIX + token, quota_remaining: quotaRemaining, isWechatArticle: true, downloadTitle: imaData?.title || '', wechatImages: images };
  } catch (err) {
    console.error('[微信文章] 抓取失败，回退到 URL 模式: ' + (err as Error).message);
    return { success: true, data: imaData, jump_url: 'data:text/plain;charset=utf-8,' + encodeURIComponent(url), quota_remaining: quotaRemaining, isUrlText: true, downloadTitle: imaData?.title || '' };
  }
}

async function collectKnowledgeViaBg(req: { knowledgeBaseId: string; fileCount?: number; incremental?: any; folderScope?: any }) {
  const tab = await getActiveImaTab();
  if (!tab?.id) return { success: false, error: '请重新从插件弹窗开始导出，系统需要先创建本次导出专用的 IMA 页面' };
  const { headers } = await getAccountAndHeaders(tab.id);
  const total = req.fileCount || 0;
  await browser.storage.session.set({ collect_progress: { collected: 0, total, ts: Date.now() } });
  try {
    const result = await collectKnowledgeInBg(headers, req.knowledgeBaseId, (collected) => {
      browser.storage.session.set({ collect_progress: { collected, total, ts: Date.now() } });
    }, req.incremental, req.folderScope);
    return { success: true, data: result };
  } finally {
    browser.storage.session.remove('collect_progress');
  }
}

async function getKnowledgeBaseList() {
  const tab = await getActiveImaTab();
  if (!tab?.id) return { success: false, error: '请重新从插件弹窗开始导出，系统需要先创建本次导出专用的 IMA 页面' };
  const res = await sendToTab(tab.id, { type: 'GET_ACCOUNT_INFO' });
  if (!ok(res)) return { success: false, error: '请先登录 IMA 后再进入知识库导出', needImaLogin: true, imaTabId: tab.id };
  const headers = buildImaHeaders(res.data, await probeVersion(tab.id));
  return { success: true, data: await fetchKnowledgeBaseList(headers, res.data.uid) };
}

async function getKnowledgeFolderPage(req: { knowledgeBaseId: string; parentFolderId: string; parentPath?: string; cursor?: string }) {
  const tab = await getActiveImaTab();
  if (!tab?.id) return { success: false, error: '请重新打开 IMA 页面后再选择文件夹' };
  const { headers } = await getAccountAndHeaders(tab.id);
  return { success: true, data: await fetchFolderPage(headers, req.knowledgeBaseId, req.parentFolderId, req.parentPath, req.cursor) };
}

/** 下载占位 URL 解析（产物 En/An/In）。 */
async function resolveDownloadUrl(requestUrl: string): Promise<string> {
  if (!requestUrl.startsWith(WECHAT_PENDING_PREFIX)) return requestUrl;
  const token = requestUrl.slice(WECHAT_PENDING_PREFIX.length);
  const image = wechatImages.get(token);
  if (image) { wechatImages.delete(token); return 'data:' + image.mimeType + ';base64,' + image.base64; }
  const body = wechatBodies.get(token);
  wechatBodies.delete(token);
  if (!body) throw new Error('文章内容已过期，请重试');
  return textToDataUrl(body, 'text/html');
}

async function downloadFile(req: { url: string; filename: string }) {
  const url = await resolveDownloadUrl(req.url);
  const filename = await normalizeRelativePath(req.filename);
  const downloadId = await browser.downloads.download({ url, filename: filename || undefined });
  await waitForDownload(downloadId);
  return { success: true, downloadId };
}

/** 下载进度看门狗（产物 _n）：30s 无新字节则中断。 */
function waitForDownload(downloadId: number, stallMs = DOWNLOAD_STALL_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    let lastBytes = -1;
    let stallTimer: ReturnType<typeof setTimeout>;
    const finish = () => { if (done) return; done = true; clearTimeout(stallTimer); clearInterval(pollTimer); browser.downloads.onChanged.removeListener(onChanged); };
    const arm = () => { clearTimeout(stallTimer); stallTimer = setTimeout(() => { if (done) return; finish(); browser.downloads.cancel(downloadId).catch(() => {}); reject(new Error('下载长时间无进度，请重试')); }, stallMs); };
    const bump = (bytes: number) => { if (bytes > lastBytes) { lastBytes = bytes; arm(); } };
    const onChanged = (delta: chrome.downloads.DownloadDelta) => {
      if (delta.id !== downloadId) return;
      if (delta.bytesReceived?.current !== undefined) bump(delta.bytesReceived.current);
      if (delta.state?.current === 'complete') { finish(); resolve(); }
      else if (delta.state?.current === 'interrupted') { finish(); reject(new Error(delta.error?.current ? '下载中断：' + delta.error.current : '下载中断')); }
    };
    const poll = async () => {
      if (done) return;
      try {
        const [item] = await browser.downloads.search({ id: downloadId });
        if (done || !item) return;
        bump(item.bytesReceived);
        if (item.state === 'complete') { finish(); resolve(); }
        else if (item.state === 'interrupted') { finish(); reject(new Error(item.error ? '下载中断：' + item.error : '下载中断')); }
      } catch { /* ignore */ }
    };
    const pollTimer = setInterval(poll, 1000);
    arm();
    browser.downloads.onChanged.addListener(onChanged);
    void poll();
  });
}

async function fetchDownloadContent(req: { url: string }) {
  let bytes: Uint8Array;
  let mime = 'application/octet-stream';
  if (req.url.startsWith(WECHAT_PENDING_PREFIX)) {
    const token = req.url.slice(WECHAT_PENDING_PREFIX.length);
    const image = wechatImages.get(token);
    if (image) { wechatImages.delete(token); bytes = dataUrlToBytes('data:' + image.mimeType + ';base64,' + image.base64).bytes; mime = image.mimeType; }
    else {
      const body = wechatBodies.get(token);
      wechatBodies.delete(token);
      if (!body) throw new Error('文章内容已过期，请重试');
      bytes = new TextEncoder().encode(body);
      mime = 'text/html';
    }
  } else if (req.url.startsWith('data:')) {
    const parsed = dataUrlToBytes(req.url);
    bytes = parsed.bytes;
    mime = parsed.mime;
  } else {
    const res = await fetch(req.url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    mime = res.headers.get('content-type') || mime;
    bytes = new Uint8Array(await res.arrayBuffer());
  }
  const { bytesToBase64 } = await import('../lib/ima/crypto');
  return { success: true, base64: bytesToBase64(bytes), mime, byteLength: bytes.byteLength };
}

/* ---------- 启动 ---------- */

export default defineBackground(() => {
  browser.action.onClicked.addListener(() => { void openAuthPage(); });

  // 授权初始化：注册设备 + 首次心跳；SW 存活期间每 30 分钟续心跳（吊销/过期会清 token）
  if (!DIRECT_MODE_BUILD) {
    void (async () => {
      try {
        await ensureRegistered();
        await heartbeat();
      } catch (err) {
        console.error('[License] 初始化失败', err);
      }
    })();
    setInterval(() => { void heartbeat().catch(() => undefined); }, 30 * 60 * 1000);
  }

  browser.runtime.onConnect.addListener((port) => {
    if (port.name === 'keep-alive') {
      port.onMessage.addListener(() => { try { port.postMessage({ type: 'pong' }); } catch { /* ignore */ } });
    }
  });

  browser.tabs.onRemoved.addListener(async (tabId) => {
    const [stored] = await Promise.all([browser.storage.local.get(ACTIVE_TAB_KEY)]);
    if (stored[ACTIVE_TAB_KEY] === tabId) {
      console.error('[IMA Tab] 专用页面已关闭，清理绑定 tab=' + tabId);
      await clearActiveTab();
    }
  });

  browser.runtime.onMessage.addListener((message: any, _sender, sendResponse) => {
    const respond = (promise: Promise<any>, onError?: (e: unknown) => any) => {
      promise.then((r) => sendResponse(r)).catch((e) => sendResponse(onError ? onError(e) : { success: false, error: e instanceof Error ? e.message : String(e) }));
      return true;
    };
    switch (message?.type) {
      case 'OPEN_AUTH_PAGE': return respond(openAuthPage());
      case 'START_EXPORT': return respond(startExport());
      case 'SET_ACTIVE_IMA_TAB': return respond(setActiveImaTab(message));
      case 'GET_MEDIA':
      case 'GET_ACCOUNT_INFO': return respond(forwardToActiveTab(message));
      case 'CHECK_QUOTA': return respond(handleCheckQuota());
      case 'LICENSE_STATUS': return respond(handleLicenseStatus());
      case 'LICENSE_ACTIVATE': return respond(handleLicenseActivate(String(message?.code || '')));
      case 'LICENSE_CONSUME': return respond(consumeQuota(Number(message?.n) || 1).then((remaining) => ({ success: true, remaining })));
      case 'LICENSE_DEACTIVATE': return respond(deactivate().then(() => ({ success: true })));
      case 'GET_MEDIA_VIA_BACKEND': return respond(getMediaViaBackend(message));
      case 'COLLECT_KNOWLEDGE_VIA_BG': return respond(collectKnowledgeViaBg(message));
      case 'GET_KNOWLEDGE_BASE_LIST': return respond(getKnowledgeBaseList());
      case 'GET_KNOWLEDGE_FOLDER_PAGE': return respond(getKnowledgeFolderPage(message));
      case 'DOWNLOAD_FILE': return respond(downloadFile(message));
      case 'FETCH_DOWNLOAD_CONTENT': return respond(fetchDownloadContent(message));
      default: return undefined;
    }
  });
});
