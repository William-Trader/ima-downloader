/*!
 * entrypoints/content.ts — ima-downloader 关键下载/授权逻辑
 * © 2026 William-Trader (https://github.com/William-Trader/ima-downloader)
 * WM: IMADL-WM-867F5E54
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * 依据 PolyForm Noncommercial 1.0.0：仅限非商业用途，禁止任何商业化使用。
 * 本文件含防拷贝水印标记，请勿删除；移除即视为违反许可证。
 */
import { browser } from '../lib/env';
import { buildImaHeaders, readAccountInfoFromPage, readProbedWebVersion } from '../lib/ima/account';
import { secureGetMedia } from '../lib/ima/crypto';
import { EP } from '../lib/ima/constants';

/** 逆向重建：content script（产物 content.js）—— 在 ima.qq.com 注入登录提示 + 提供账号/媒体数据。 */

const HINT_HOST_ID = 'ima-export-login-hint-host';
let cleanupHint: (() => void) | null = null;

export default defineContentScript({
  matches: ['*://ima.qq.com/*'],
  main() {
    console.error('[ima-export] Content script loaded');
    browser.runtime.onMessage.addListener((message: any, _sender, sendResponse) => {
      if (message?.type === 'SHOW_IMA_LOGIN_HINT') { showLoginHint(); sendResponse({ success: true }); return; }
      if (message?.type === 'GET_ACCOUNT_INFO') {
        try {
          const account = readAccountInfoFromPage();
          if (!account) { sendResponse({ success: false, error: '未找到 accountInfo' }); return; }
          sendResponse({ success: true, data: account });
        } catch { sendResponse({ success: false, error: 'accountInfo 解析失败' }); }
        return;
      }
      if (message?.type === 'GET_MEDIA') {
        let headers;
        try {
          const account = readAccountInfoFromPage();
          if (!account) { sendResponse({ success: false, error: '未找到 accountInfo' }); return true; }
          headers = buildImaHeaders(account, readProbedWebVersion());
        } catch { sendResponse({ success: false, error: 'accountInfo 解析失败' }); return true; }
        const body: Record<string, unknown> = { media_id: message.mediaId };
        if (message.knowledgeBaseId) { body.knowledge_base_id = message.knowledgeBaseId; body.knowledge_id = message.knowledgeBaseId; }
        secureGetMedia(headers as unknown as Record<string, string>, body, EP.getMedia)
          .catch(() => fetch(EP.getMediaPlain, { method: 'POST', headers, credentials: 'include', body: JSON.stringify(body) }).then((r) => r.json()))
          .then((data) => sendResponse({ success: true, data }))
          .catch((err) => sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) }));
        return true;
      }
      return undefined;
    });
  },
});

/* ---------- 登录提示浮层（Shadow DOM） ---------- */

function isVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
}

function findLoginButton(): HTMLElement | null {
  return (Array.from(document.querySelectorAll("button, [role='button'], a, div, span")).filter(isVisible).find((el) => el.textContent?.trim() === '登录') as HTMLElement) || null;
}

function hideHint() {
  cleanupHint?.();
  cleanupHint = null;
  document.getElementById(HINT_HOST_ID)?.remove();
}

function hintStyles(): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = `
    :host { --ink-900:#0b0d12; --ink-600:#3b4048; --ink-500:#5a606b; --surface:#fff; --bg:#f5f6f8;
      --line:#e3e5ea; --brand-600:#4338ca; --brand-soft:#eef2ff; --ok-600:#047857; --ok-soft:#ecfdf5;
      --err-600:#b91c1c; --err-soft:#fef2f2; color:var(--ink-900);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size:15px; }
    .card { position:fixed; top:22px; left:50%; z-index:2147483647; width:min(520px,calc(100vw - 32px)); box-sizing:border-box;
      transform:translateX(-50%); border:1px solid var(--ink-900); border-radius:8px; background:var(--surface);
      box-shadow:0 24px 64px rgba(11,13,18,.24); padding:18px; }
    .head { display:flex; align-items:flex-start; gap:12px; }
    .icon { display:inline-flex; width:34px; height:34px; flex:0 0 auto; align-items:center; justify-content:center;
      border-radius:8px; background:var(--brand-soft); color:var(--brand-600); font-size:17px; font-weight:700; line-height:1; }
    .copy { min-width:0; flex:1; }
    .title { color:var(--ink-900); font-size:17px; font-weight:700; line-height:1.35; }
    .desc { margin-top:7px; color:var(--ink-600); font-size:14px; line-height:1.7; }
    .close { appearance:none; width:28px; height:28px; border:0; border-radius:8px; background:transparent; color:var(--ink-500);
      cursor:pointer; font-size:20px; line-height:1; }
    .close:hover { background:var(--bg); color:var(--ink-900); }
    .actions { display:flex; gap:8px; margin-top:16px; }
    .button { appearance:none; height:40px; border-radius:8px; border:1px solid var(--line); cursor:pointer; font-size:14px; font-weight:650; padding:0 16px; }
    .primary { flex:1; border-color:var(--ink-900); background:var(--ink-900); color:var(--surface); }
    .secondary { background:var(--surface); color:var(--ink-600); }
    .success .icon { background:var(--ok-soft); color:var(--ok-600); }
    .fail .icon { background:var(--err-soft); color:var(--err-600); }
    @media (max-width:560px){ .card{ top:16px; left:16px; right:16px; width:auto; transform:none; } }
  `;
  return style;
}

function showLoginHint() {
  hideHint();
  const host = document.createElement('div');
  host.id = HINT_HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });
  const card = document.createElement('section');
  card.className = 'card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'IMA 登录提示');

  const head = document.createElement('div');
  head.className = 'head';
  const icon = document.createElement('div');
  icon.className = 'icon';
  icon.textContent = 'i';
  const copy = document.createElement('div');
  copy.className = 'copy';
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = '需要先登录 IMA';
  const desc = document.createElement('div');
  desc.className = 'desc';
  desc.textContent = 'ima 导出助手需要读取你已登录后可访问的知识库。请点击下方按钮打开 IMA 登录窗口，完成后回到导出助手继续。';
  const close = document.createElement('button');
  close.className = 'close';
  close.type = 'button';
  close.setAttribute('aria-label', '关闭提示');
  close.textContent = '×';
  close.addEventListener('click', hideHint);
  copy.append(title, desc);
  head.append(icon, copy, close);

  const actions = document.createElement('div');
  actions.className = 'actions';
  const primary = document.createElement('button');
  primary.className = 'button primary';
  primary.type = 'button';
  primary.textContent = '打开登录';
  const secondary = document.createElement('button');
  secondary.className = 'button secondary';
  secondary.type = 'button';
  secondary.textContent = '稍后';
  secondary.addEventListener('click', hideHint);
  actions.append(primary, secondary);
  card.append(head, actions);
  shadow.append(hintStyles(), card);
  document.documentElement.append(host);

  let mode: 'login' | 'return' = 'login';
  primary.addEventListener('click', () => {
    if (mode === 'return') {
      browser.runtime.sendMessage({ type: 'OPEN_AUTH_PAGE' }).catch((err: unknown) => console.error('[ima-export] 打开导出助手页面失败', err));
      return;
    }
    if (findLoginButton()?.click() !== undefined) {
      title.textContent = '登录窗口已打开';
      desc.textContent = '请使用微信完成登录。登录完成后，回到 ima 导出助手页面点击继续。';
      return;
    }
    card.classList.add('fail');
    title.textContent = '没有找到登录按钮';
    desc.textContent = '请手动点击页面右上角的「登录」。完成后回到 ima 导出助手页面点击继续。';
  });

  const timer = window.setInterval(() => {
    try {
      if (!readAccountInfoFromPage()) return;
      window.clearInterval(timer);
      card.classList.remove('fail');
      card.classList.add('success');
      icon.textContent = '✓';
      title.textContent = '已检测到 IMA 登录';
      desc.textContent = '现在可以回到 ima 导出助手继续进入知识库导出。';
      primary.textContent = '回到导出助手';
      mode = 'return';
      secondary.textContent = '留在 IMA';
    } catch (err) { console.error('[ima-export] 检查 IMA 登录状态失败', err); }
  }, 1200);
  cleanupHint = () => window.clearInterval(timer);
}
