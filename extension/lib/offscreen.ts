/*!
 * lib/offscreen.ts — ima-downloader 关键下载/授权逻辑
 * © 2026 William-Trader (https://github.com/William-Trader/ima-downloader)
 * WM: IMADL-WM-E9D5BAD9
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * 依据 PolyForm Noncommercial 1.0.0：仅限非商业用途，禁止任何商业化使用。
 * 本文件含防拷贝水印标记，请勿删除；移除即视为违反许可证。
 */
import { browser } from './env';
import { OFFSCREEN_PATH } from './ima/constants';

/** 逆向重建：runtime.html（offscreen document）生命周期管理（产物 Ue/Qt/Xt/Zt/en/tn/nn/rn）。 */
const REASONS = ['DOM_PARSER'];
const JUSTIFICATION = 'Parse wechat article HTML with DOMParser in offscreen document.';
const PING_ATTEMPTS = 20;
const PING_INTERVAL = 150;
const ENSURE_ROUNDS = 5;

let ensuring: Promise<void> | null = null;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e || ''));

export async function closeOffscreen(): Promise<void> {
  try {
    await browser.offscreen.closeDocument();
  } catch (err) {
    const msg = errText(err);
    if (msg.includes('No current offscreen document') || msg.includes('offscreen document not found')) return;
    throw err;
  }
}

async function hasOffscreen(url: string): Promise<boolean> {
  const contexts = await (browser.runtime as any).getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
  return contexts.length > 0;
}

async function createOffscreen(url: string): Promise<void> {
  try {
    await browser.offscreen.createDocument({ url, reasons: REASONS as any, justification: JUSTIFICATION });
  } catch (err) {
    if (!errText(err).includes('single offscreen')) throw err;
  }
}

async function ping(attempts: number, interval: number): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res: any = await browser.runtime.sendMessage({ action: 'offscreen-ping', type: 'offscreen-ping', timestamp: Date.now() });
      if (res?.ready) return true;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, interval));
  }
  return false;
}

/** 确保 offscreen 就绪（最多重建 5 轮）。 */
export async function ensureOffscreen(justification = JUSTIFICATION): Promise<void> {
  const url = browser.runtime.getURL(OFFSCREEN_PATH);
  for (let round = 1; round <= ENSURE_ROUNDS; round++) {
    if (!(await hasOffscreen(url))) await createOffscreen(url);
    if (await ping(PING_ATTEMPTS, PING_INTERVAL)) return;
    console.error('[ensureOffscreen] 第 ' + round + ' 轮未就绪，关闭并重建 offscreen');
    await closeOffscreen();
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('offscreen 环境初始化失败（已重试 ' + ENSURE_ROUNDS + ' 轮）');
}

/** 并发安全地确保 offscreen 就绪（产物 rn 的单飞封装）。 */
export function withOffscreen(justification = JUSTIFICATION): Promise<void> {
  if (!ensuring) {
    ensuring = ensureOffscreen(justification).finally(() => { ensuring = null; });
  }
  return ensuring;
}

/** 动态规则：给 mmbiz.qpic.cn 补 Referer，绕微信图床防盗链（产物 on/an）。 */
export async function enableWechatReferer(): Promise<void> {
  try {
    await browser.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [9001],
      addRules: [
        {
          id: 9001,
          priority: 1,
          action: {
            type: browser.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
            requestHeaders: [{ header: 'Referer', operation: browser.declarativeNetRequest.HeaderOperation.SET, value: 'https://mp.weixin.qq.com/' }],
          },
          condition: {
            urlFilter: '||mmbiz.qpic.cn',
            resourceTypes: [
              browser.declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
              browser.declarativeNetRequest.ResourceType.IMAGE,
              browser.declarativeNetRequest.ResourceType.OTHER,
            ],
          },
        },
      ],
    });
  } catch (err) {
    console.error('[Wechat] 设置 Referer 规则失败:', err);
  }
}

export async function disableWechatReferer(): Promise<void> {
  try {
    await browser.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [9001] });
  } catch (err) {
    console.error('[Wechat] 移除 Referer 规则失败:', err);
  }
}

/** 抓取并内嵌微信文章（产物 pn）。 */
export async function fetchAndEmbedWechatArticle(articleUrl: string) {
  await enableWechatReferer();
  try {
    await withOffscreen();
    const res: any = await browser.runtime.sendMessage({ action: 'wechat-fetch-and-embed', type: 'wechat-fetch-and-embed', timestamp: Date.now(), data: { articleUrl } });
    if (!res?.success) throw new Error(res?.error || '微信文章抓取失败');
    if (!res.data) throw new Error('微信文章抓取返回内容为空');
    return res.data as { contentHtml: string; images: Array<{ url: string; base64: string; mimeType: string; localPath: string }>; imageStats: { success: number; total: number }; cssCount: number };
  } finally {
    await disableWechatReferer();
  }
}
