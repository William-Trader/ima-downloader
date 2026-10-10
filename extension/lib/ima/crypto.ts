/*!
 * lib/ima/crypto.ts — ima-downloader 关键下载/授权逻辑
 * © 2026 William-Trader (https://github.com/William-Trader/ima-downloader)
 * WM: IMADL-WM-E4025210
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * 依据 PolyForm Noncommercial 1.0.0：仅限非商业用途，禁止任何商业化使用。
 * 本文件含防拷贝水印标记，请勿删除；移除即视为违反许可证。
 */
import { IMA_MEDIA_PUBLIC_KEY } from './constants';

/** 逆向重建：base64 分块转换（产物 J/V/lt/be/Ee/ve/ke/Ft/Lt/Dt/qt/Bt）。 */
const CHUNK = 32768;

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

export function base64ToBytes(b64: string): Uint8Array {
  const raw = atob(b64.trim());
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export function utf8ToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}

/** 把任意字符串编码成 data URL（产物 be）。 */
export function textToDataUrl(text: string, mime: string): string {
  return 'data:' + mime + ';base64,' + utf8ToBase64(text);
}

/** 解析 data URL 为字节（产物 Ee）。 */
export function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const m = /^data:([^,]*),(.*)$/s.exec(dataUrl);
  if (!m) throw new Error('无效的 data URL');
  const meta = m[1].split(';');
  const mime = meta[0] || 'application/octet-stream';
  const isBase64 = meta.slice(1).some((s) => s.toLowerCase() === 'base64');
  const body = m[2] || '';
  return {
    bytes: isBase64 ? base64ToBytes(body) : new TextEncoder().encode(decodeURIComponent(body)),
    mime,
  };
}

/** 把 ArrayBuffer 复制成独立 buffer（产物 ge）。 */
export function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
}

let publicKeyPromise: Promise<CryptoKey> | null = null;

function pemToBytes(pem: string): Uint8Array {
  return base64ToBytes(pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, ''));
}

function importPublicKey(): Promise<CryptoKey> {
  if (!publicKeyPromise) {
    publicKeyPromise = crypto.subtle.importKey('spki', toArrayBuffer(pemToBytes(IMA_MEDIA_PUBLIC_KEY)), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  }
  return publicKeyPromise;
}

export interface SecureEnvelope {
  aesKey: CryptoKey;
  /** iv||ciphertext 的 base64 */
  body: string;
  /** RSA-OAEP(aesKey) 的 base64 */
  encryptedKey: string;
}

/**
 * 安全下载信封（产物 Dt）：随机 AES-128-GCM 密钥加密请求体，
 * 密钥再用 IMA 的 RSA-OAEP 公钥包裹；密文布局 = iv(12B) || ciphertext。
 */
export async function buildSecureEnvelope(plainText: string): Promise<SecureEnvelope> {
  const aesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 128 }, true, ['encrypt', 'decrypt']);
  const rawKey = await crypto.subtle.exportKey('raw', aesKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, aesKey, new TextEncoder().encode(plainText)),
  );
  const joined = new Uint8Array(iv.length + cipher.length);
  joined.set(iv);
  joined.set(cipher, iv.length);
  const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, await importPublicKey(), rawKey);
  return { aesKey, body: bytesToBase64(joined), encryptedKey: bytesToBase64(new Uint8Array(wrapped)) };
}

/** 解密安全响应（产物 qt）：iv(12B) || ciphertext。 */
export async function decryptSecureResponse(b64: string, aesKey: CryptoKey): Promise<string> {
  const bytes = base64ToBytes(b64);
  if (bytes.length <= 28) throw new Error('IMA 安全响应格式异常');
  const iv = bytes.subarray(0, 12);
  const cipher = bytes.subarray(12);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, aesKey, cipher);
  return new TextDecoder().decode(plain);
}

/**
 * 调用安全 get_media 接口（产物 Bt）：
 * 请求头加 x-ima-cm:1 / x-ima-ckey:<wrapped key>，去掉 x-ima-ctk，body 为密文 base64。
 */
export async function secureGetMedia(headers: Record<string, string>, payload: unknown, endpoint: string, fetcher: typeof fetch = fetch) {
  const envelope = await buildSecureEnvelope(JSON.stringify(payload));
  const h = new Headers(headers);
  h.set('x-ima-cm', '1');
  h.set('x-ima-ckey', envelope.encryptedKey);
  h.delete('x-ima-ctk');
  const res = await fetcher(endpoint, { method: 'POST', headers: h, credentials: 'include', body: envelope.body });
  const text = await res.text();
  if (!res.ok || !text) throw new Error('IMA 安全下载接口 HTTP ' + res.status);
  return JSON.parse(await decryptSecureResponse(text, envelope.aesKey));
}
