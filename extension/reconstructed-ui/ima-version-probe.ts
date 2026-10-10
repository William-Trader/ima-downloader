import { IMA_VERSION_ATTR } from '../lib/ima/constants';

/** 逆向重建：main-world 探针（产物 ima-version-probe.js）。抓取 IMA 请求头里的 WEB-VERSION 并写回 DOM。 */

function applyCookie(cookie: string | null | undefined) {
  const version = /(?:^|;\s*)WEB-VERSION=([^;\s]+)/i.exec(cookie || '')?.[1]?.trim() || '';
  if (!version || !/^[0-9A-Za-z._+-]{1,64}$/.test(version)) return;
  const root = document.documentElement;
  if (!root || root.getAttribute(IMA_VERSION_ATTR) === version) return;
  root.setAttribute(IMA_VERSION_ATTR, version);
}

function inspectHeaders(headers: HeadersInit | undefined | null) {
  if (!headers) return;
  try { applyCookie(new Headers(headers).get('x-ima-cookie')); } catch { /* ignore */ }
}

export default defineContentScript({
  matches: ['https://ima.qq.com/*', 'https://*.ima.qq.com/*'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    const originalFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
      inspectHeaders(init?.headers);
      if (!init?.headers && input instanceof Request) inspectHeaders(input.headers);
      return originalFetch(input as any, init);
    } as typeof fetch;

    const proto = globalThis.XMLHttpRequest?.prototype;
    if (!proto?.setRequestHeader) return;
    const originalSet = proto.setRequestHeader;
    proto.setRequestHeader = function (name: string, value: string) {
      if (name.toLowerCase() === 'x-ima-cookie') applyCookie(value);
      return originalSet.call(this, name, value);
    };
  },
});
