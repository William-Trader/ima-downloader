/**
 * 逆向重建：offscreen document（产物 runtime.html + chunks/runtime-*.js）。
 * 职责：用 DOMParser 解析微信公众号文章、下载并内联图片、收集 CSS。
 */
import { OFFSCREEN_PING, WECHAT_FETCH_AND_EMBED } from '../../lib/runtime-protocol';

const sentinel = (value: unknown) => value;

async function ping(): Promise<{ ready: boolean }> {
  return { ready: true };
}

/* ---------- 微信公众号文章抓取 ---------- */

const IMG_REFERER = 'https://mp.weixin.qq.com/';
const MAX_IMAGES = 150;

interface FetchedImage { url: string; base64: string; mimeType: string; localPath: string }

function pad(n: number) { return n < 10 ? '0' + n : String(n); }
function stamp(d = new Date()) { return d.getFullYear() + '年' + pad(d.getMonth() + 1) + '月' + pad(d.getDate()) + '日 ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** 把图片下载成 base64，失败时保留原 URL。 */
async function fetchImage(url: string, index: number): Promise<FetchedImage | null> {
  try {
    const res = await fetch(url, { referrer: IMG_REFERER, credentials: 'omit' } as RequestInit);
    if (!res.ok) throw new Error('图片 HTTP ' + res.status + ': ' + url);
    const blob = await res.blob();
    const mimeType = blob.type || 'image/png';
    const ext = (mimeType.split('/')[1] || 'png').replace('jpeg', 'jpg').split('+')[0];
    return { url, base64: await blobToBase64(blob), mimeType, localPath: 'img/image_' + (index + 1) + '.' + ext };
  } catch (err) {
    console.error('图片下载失败: ' + url, err);
    return null;
  }
}

async function fetchAndEmbedArticle(articleUrl: string) {
  const res = await fetch(articleUrl, { credentials: 'omit' });
  if (!res.ok) throw new Error('微信文章抓取失败: HTTP ' + res.status);
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // 收集内联 <style> 与外链 CSS 的文本，供导出侧一并写入归档
  const styleNodes = Array.from(doc.querySelectorAll('style'));
  const cssTexts = styleNodes.map((n) => n.textContent || '').filter(Boolean);
  const linkHrefs = Array.from(doc.querySelectorAll('link[rel="stylesheet"]')).map((n) => (n as HTMLLinkElement).href).filter(Boolean);
  for (const href of linkHrefs) {
    try {
      const cssRes = await fetch(href, { referrer: IMG_REFERER, credentials: 'omit' });
      if (cssRes.ok) cssTexts.push(await cssRes.text());
    } catch (err) { console.error('CSS 下载失败: ' + href, err); }
  }

  // 图片本地化：把 <img src> 替换为 placeholder，交给 background/downloads 落盘
  const imgs = Array.from(doc.querySelectorAll('img[src]')) as HTMLImageElement[];
  const picked = imgs.filter((img) => /^https?:\/\//.test(img.src)).slice(0, MAX_IMAGES);
  const settled = await Promise.all(picked.map((img, i) => fetchImage(img.src, i)));
  const images: FetchedImage[] = [];
  settled.forEach((image, i) => {
    if (!image) return;
    images.push(image);
    picked[i].setAttribute('src', image.localPath);
  });

  const title = doc.querySelector('h1')?.textContent?.trim() || doc.title || '微信公众号文章';
  const contentHtml = '<meta charset="utf-8"><title>' + title + '</title>\n' +
    (cssTexts.length ? '<style>\n' + cssTexts.join('\n') + '\n</style>\n' : '') +
    (doc.body?.innerHTML || '');

  console.error('解析完成: ' + images.length + ' 图 / ' + picked.length + '，本地化完成: 图片 ' + images.length + '/' + picked.length);
  return {
    success: true,
    data: {
      title,
      contentHtml,
      cssCount: cssTexts.length,
      images,
      imageStats: { success: images.length, total: picked.length },
      fetchedAt: stamp(),
    },
  };
}

/* ---------- 消息路由 ---------- */

chrome.runtime.onMessage.addListener((message: any, _sender, sendResponse) => {
  if (message?.type === OFFSCREEN_PING || message?.action === OFFSCREEN_PING) { sendResponse(sentinel({ ready: true })); return; }
  if (message?.type === WECHAT_FETCH_AND_EMBED) {
    const articleUrl = message.data?.articleUrl;
    if (!articleUrl) { sendResponse({ success: false, error: '缺少 articleUrl' }); return; }
    fetchAndEmbedArticle(articleUrl)
      .then((r) => sendResponse(r))
      .catch((err) => sendResponse({ success: false, error: '微信文章抓取失败：' + (err instanceof Error ? err.message : String(err)) }));
    return true;
  }
  return undefined;
});
