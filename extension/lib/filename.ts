/*!
 * lib/filename.ts — ima-downloader 关键下载/授权逻辑
 * © 2026 William-Trader (https://github.com/William-Trader/ima-downloader)
 * WM: IMADL-WM-7A2E6738
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * 依据 PolyForm Noncommercial 1.0.0：仅限非商业用途，禁止任何商业化使用。
 * 本文件含防拷贝水印标记，请勿删除；移除即视为违反许可证。
 */
import { browser } from './env';

/**
 * 文件名清洗（产物中 wt/yt/Se/Et/Me/Re/Tt/Oe 一组函数）。
 * 规则：先剥离零宽/控制字符，再替换 Windows 保留字符，中文/全角范围保留，
 * Windows 平台额外处理保留设备名（CON/PRN/…）并把非法字符替换为可见符号。
 */
const ZERO_WIDTH = /[\u200B\u200C\u200D\uFEFF\u2060\u180E]/g;
const INVIS_BLOCKS = /[\u2000-\u200F\u2028-\u202F\u205F-\u206F]/g;
const CONTROL = /[\x00-\x1f\x7f-\x9f]/g;
const WIN_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..+)?$/i;
/** 在 Windows 模式下允许出现在文件名里的符号映射。 */
const SYMBOLS = 'ː◄▶¦♯';

export function stripInvisible(value: string): string {
  return value.replace(ZERO_WIDTH, '').replace(INVIS_BLOCKS, '').replace(CONTROL, '');
}

/** 跨平台安全名（POSIX 风格，非 Windows）。 */
export function sanitizeName(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') return 'unnamed';
  return (
    stripInvisible(raw)
      .replace(/:+/g, 'ː')
      .replace(/\?+/g, '_')
      .replace(/\*+/g, '_')
      .replace(/<+/g, '◄')
      .replace(/>+/g, '▶')
      .replace(/"+/g, "'")
      .replace(/\|+/g, '¦')
      .replace(/[/\\]+/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/^[\s.]+/, '')
      .replace(/[\s.]+$/, '')
      .trim() || 'unnamed'
  );
}

/** Windows 安全名：额外处理 #、保留设备名。 */
export function sanitizeNameWindows(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') return 'unnamed';
  let name = stripInvisible(raw)
    .replace(/:+/g, 'ː')
    .replace(/\?+/g, '_')
    .replace(/\*+/g, '_')
    .replace(/<+/g, '◄')
    .replace(/>+/g, '▶')
    .replace(/"+/g, "'")
    .replace(/\|+/g, '¦')
    .replace(/#+/g, '♯')
    .replace(/[/\\]+/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+/, '')
    .replace(/[\s.]+$/, '')
    .trim();
  if (WIN_RESERVED.test(name)) name = '_' + name + '_';
  return name || 'unnamed';
}

const isWindows = async (): Promise<boolean> => {
  try {
    if (typeof browser !== 'undefined' && browser.runtime?.getPlatformInfo) {
      return (await browser.runtime.getPlatformInfo()).os === 'win';
    }
  } catch {
    /* ignore */
  }
  return false;
};

/** 与产物一致：按平台选择清洗策略。 */
export async function sanitizeForPlatform(raw: string): Promise<string> {
  return (await isWindows()) ? sanitizeNameWindows(raw) : sanitizeName(raw);
}

/** 白名单字符集（保留中文、全角标点、常见符号）。 */
export function filterAllowedChars(value: string): string {
  return stripInvisible(value)
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .split('')
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return (
        (code >= 32 && code <= 126) ||
        (code >= 19968 && code <= 40959) ||
        (code >= 12288 && code <= 12351) ||
        (code >= 65280 && code <= 65519) ||
        ch === ' ' ||
        ch === '-' ||
        ch === '_' ||
        ch === '.' ||
        SYMBOLS.includes(ch)
      );
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 先清洗再截断（保留扩展名）。 */
export function safeTruncate(value: string, max = 200): string {
  if (!value || typeof value !== 'string') return '';
  return filterAllowedChars(value).replace(/^\.+/, '').replace(/\.+$/, '').slice(0, max);
}

function splitExt(name: string): { base: string; ext: string } {
  const i = name.lastIndexOf('.');
  if (i <= 0 || i === name.length - 1) return { base: name, ext: '' };
  return { base: name.slice(0, i), ext: name.slice(i) };
}

/** 保留扩展名的截断（产物的 Re）。 */
export function truncateKeepExt(name: string, max: number): string {
  if (name.length <= max) return name;
  const { base, ext } = splitExt(name);
  if (!ext) return name.slice(0, max);
  const room = max - ext.length;
  return room <= 0 ? name.slice(0, max) : base.slice(0, room) + ext;
}

/** 文件名的最终处理（产物的 At 的叶子部分：文件名）。 */
export async function normalizeFilename(name: string, max = 200): Promise<string> {
  if (!name || typeof name !== 'string') return 'unnamed';
  const { base, ext } = splitExt(name);
  const cleanBase = safeTruncate(base, Math.max(1, max - ext.length)) || 'unnamed';
  const cleanExt = ext ? '.' + filterAllowedChars(ext.slice(1)).replace(/\./g, '') : '';
  return cleanBase + cleanExt;
}

/** 相对路径按段清洗（产物的 At：目录段用平台名，末段用文件名）。 */
export async function normalizeRelativePath(input: string): Promise<string> {
  if (!input || !input.trim()) return '';
  const segments = input.split('/').filter(Boolean);
  if (!segments.length) return '';
  const out: string[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    out.push(i === segments.length - 1 ? await normalizeFilename(segments[i]) : await sanitizeForPlatform(segments[i]));
  }
  return out.filter(Boolean).join('/');
}
