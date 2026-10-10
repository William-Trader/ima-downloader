/*!
 * lib/license.ts — ima-downloader 关键下载/授权逻辑
 * © 2026 William-Trader (https://github.com/William-Trader/ima-downloader)
 * WM: IMADL-WM-1F88A5AA
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * 依据 PolyForm Noncommercial 1.0.0：仅限非商业用途，禁止任何商业化使用。
 * 本文件含防拷贝水印标记，请勿删除；移除即视为违反许可证。
 */
import { browser, DIRECT_MODE, LICENSE_BASE_URL } from './env';

/**
 * 授权层 —— 对接清尘服务器 qc-license 卡密系统（/api/v1 协议 v1）。
 *
 * 协议见 ~/openclaw资产库/qc-license/SPEC.md：
 *   POST /api/v1/register   {device_id, name, ts, nonce}                      -> {ok, ts}
 *   POST /api/v1/activate   {code, device_id, device_name, ts, nonce}         -> {ok, data:{plan, expires_at, token, remaining}}
 *   POST /api/v1/heartbeat  {device_id, token, ts, nonce}                     -> {ok, data:{plan, status, expires_at, remaining}}
 *   POST /api/v1/consume    {device_id, token, ts, nonce, n}                  -> {ok, data:{consumed, remaining}}
 *   POST /api/v1/deactivate {device_id, token, ts, nonce}                     -> {ok}
 * 防重放：请求体带 ts(秒) + nonce(随机串)，服务端 ±300s 窗口且 nonce 不可复用。
 */

export class AuthExpiredError extends Error {
  constructor(message = '登录已过期，请重新登录') {
    super(message);
    this.name = 'AuthExpiredError';
  }
}

export class QuotaExhaustedError extends Error {
  constructor(message = '配额不足或已过期，请联系管理员充值') {
    super(message);
    this.name = 'QuotaExhaustedError';
  }
}

export class RateLimitError extends Error {
  constructor(message = '下载失败过多，请稍后再试') {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class LicenseError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'LicenseError';
    this.code = code;
  }
}

export interface QuotaInfo {
  is_active: boolean;
  is_member: boolean;
  membership_type: string;
  membership_expires_at: string;
  total_quota_remaining: number;
}

export interface ActivationResult {
  plan: string;
  expires_at: string | null;
  remaining: number | null;
  device_id: string;
}

/** CHROME_STORAGE_KEYS —— 与产物 storage.local 键名一致（新增设备/授权字段）。 */
export const storageKeys = {
  authToken: 'auth_token',
  authUser: 'auth_user',
  deviceId: 'qc_device_id',
  deviceName: 'qc_device_name',
  licenseBase: 'qc_license_base',
  licenseStatus: 'qc_license_status',
  licenseRemaining: 'qc_license_remaining',
  licenseExpiresAt: 'qc_license_expires_at',
  licensePlan: 'qc_license_plan',
} as const;

const client = browser.storage.local;

const INACTIVE: QuotaInfo = {
  is_active: false,
  is_member: false,
  membership_type: 'none',
  membership_expires_at: '',
  total_quota_remaining: 0,
};

const DIRECT_STUB: QuotaInfo = {
  is_active: true,
  is_member: true,
  membership_type: 'lifetime',
  membership_expires_at: '2099-12-31T00:00:00Z',
  total_quota_remaining: 9999,
};

/** 服务端时间字段兼容：接受 epoch 秒 / epoch 毫秒 / ISO 字符串，统一转 ISO（页面直接 new Date() 可读）。 */
function toIso(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'string' && /[T-]/.test(v)) return v;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return String(v);
  const ms = n > 1e12 ? n : n * 1000;
  try {
    return new Date(ms).toISOString();
  } catch {
    return String(v);
  }
}

function rid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function getBase(): Promise<string> {
  const got = await client.get(storageKeys.licenseBase);
  const custom = got[storageKeys.licenseBase];
  return typeof custom === 'string' && custom ? custom.replace(/\/+$/, '') : LICENSE_BASE_URL;
}

export async function setBase(baseUrl: string): Promise<void> {
  await client.set({ [storageKeys.licenseBase]: baseUrl.replace(/\/+$/, '') });
}

/** 设备指纹：首次生成后持久化（qc-license 一卡一机绑定依据）。 */
export async function getDeviceId(): Promise<string> {
  const got = await client.get(storageKeys.deviceId);
  const cached = got[storageKeys.deviceId];
  if (typeof cached === 'string' && cached) return cached;
  const id = 'dev_' + rid() + rid().slice(0, 8);
  await client.set({ [storageKeys.deviceId]: id });
  return id;
}

export async function getDeviceName(): Promise<string> {
  const got = await client.get(storageKeys.deviceName);
  const cached = got[storageKeys.deviceName];
  if (typeof cached === 'string' && cached) return cached;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const name = (ua.match(/\(([^)]+)\)/) || [])[1] || 'chrome-extension';
  await client.set({ [storageKeys.deviceName]: name });
  return name;
}

export async function getToken(): Promise<string | null> {
  const got = await client.get(storageKeys.authToken);
  const t = got[storageKeys.authToken];
  return typeof t === 'string' && t ? t : null;
}

async function clearAuth(): Promise<void> {
  await client.remove([storageKeys.authToken, storageKeys.authUser]);
}

interface ApiResult<T = any> {
  ok: boolean;
  data?: T;
  error?: string;
  message?: string;
  remaining?: number;
}

/** 统一请求：自动带 ts/nonce + device_id，错误按 qc-license 错误码映射为语义异常。 */
async function call<T = any>(action: string, payload: Record<string, unknown> = {}, opts: { withDevice?: boolean } = {}): Promise<T> {
  const base = await getBase();
  const body: Record<string, unknown> = { ...payload, ts: Math.floor(Date.now() / 1000), nonce: rid() };
  if (opts.withDevice !== false) body.device_id = await getDeviceId();

  let res: Response;
  try {
    res = await fetch(base + '/api/v1/' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new LicenseError('NETWORK_ERROR', '无法连接授权服务器（' + base + '）');
  }

  let json: ApiResult<T> = {};
  try {
    json = (await res.json()) as ApiResult<T>;
  } catch {
    json = {};
  }

  if (res.ok && json.ok) return (json.data ?? (json as unknown as T)) as T;

  const code = json.error || 'HTTP_' + res.status;
  const msg = json.message || '';
  if (code === 'UNAUTHORIZED' || code === 'CARD_EXPIRED' || code === 'CARD_REVOKED') {
    await clearAuth();
    throw new AuthExpiredError(msg || undefined);
  }
  if (code === 'QUOTA_EXHAUSTED') throw new QuotaExhaustedError(msg || undefined);
  if (code === 'REPLAY' || res.status === 429) throw new RateLimitError(msg || undefined);
  throw new LicenseError(code, msg || '授权校验失败（' + code + '）');
}

/** 设备注册（幂等，服务端 upsert）。 */
export async function ensureRegistered(): Promise<void> {
  await call('register', { name: await getDeviceName() }, { withDevice: true });
}

/** 卡密激活：成功即写入 token / 套餐 / 到期 / 剩余次数。 */
export async function activate(code: string, deviceName?: string): Promise<ActivationResult> {
  const clean = String(code || '').trim().toUpperCase();
  if (!clean) throw new LicenseError('BAD_CODE', '请输入卡密');
  const data = await call<{ plan: string; expires_at: string | null; token: string; remaining: number | null; device_id: string }>('activate', {
    code: clean,
    device_name: deviceName || (await getDeviceName()),
  });
  await client.set({
    [storageKeys.authToken]: data.token,
    [storageKeys.authUser]: { plan: data.plan, expires_at: data.expires_at, device_id: data.device_id },
    [storageKeys.licensePlan]: data.plan,
    [storageKeys.licenseExpiresAt]: data.expires_at,
    [storageKeys.licenseRemaining]: data.remaining,
    [storageKeys.licenseStatus]: 'active',
  });
  return { plan: data.plan, expires_at: data.expires_at, remaining: data.remaining, device_id: data.device_id };
}

/** 兼容产物里的兑换入口。 */
export async function redeemCode(code: string): Promise<ActivationResult> {
  if (DIRECT_MODE) throw new Error('直连模式无需兑换');
  return activate(code);
}

/** 心跳：刷新权益状态（吊销/过期会抛 AuthExpiredError 并清除 token）。 */
export async function heartbeat(): Promise<QuotaInfo> {
  if (DIRECT_MODE) return DIRECT_STUB;
  const token = await getToken();
  if (!token) return INACTIVE;
  const data = await call<{ plan: string; status: string; expires_at: string | number | null; remaining: number | null }>('heartbeat', { token });
  const expiresIso = toIso(data.expires_at);
  await client.set({
    [storageKeys.licenseStatus]: data.status,
    [storageKeys.licensePlan]: data.plan,
    [storageKeys.licenseExpiresAt]: data.expires_at,
    [storageKeys.licenseRemaining]: data.remaining,
  });
  return {
    is_active: data.status === 'active',
    // 不限次卡（remaining=null）才算「会员权益·不限次数」；有限次卡显示真实剩余次数
    is_member: data.status === 'active' && (data.remaining === null || data.remaining === undefined),
    membership_type: data.plan,
    membership_expires_at: expiresIso,
    total_quota_remaining: data.remaining === null ? -1 : data.remaining,
  };
}

/** 配额查询：心跳优先，网络不可用时回退本地缓存。 */
export async function checkQuota(): Promise<QuotaInfo> {
  if (DIRECT_MODE) return DIRECT_STUB;
  const token = await getToken();
  if (!token) return INACTIVE;
  try {
    return await heartbeat();
  } catch (err) {
    if (err instanceof AuthExpiredError) return INACTIVE;
    const got = await client.get([
      storageKeys.licenseStatus,
      storageKeys.licensePlan,
      storageKeys.licenseExpiresAt,
      storageKeys.licenseRemaining,
    ]);
    return {
      is_active: got[storageKeys.licenseStatus] === 'active',
      is_member: got[storageKeys.licenseStatus] === 'active' && Number(got[storageKeys.licenseRemaining] ?? 0) < 0,
      membership_type: String(got[storageKeys.licensePlan] || 'unknown'),
      membership_expires_at: String(got[storageKeys.licenseExpiresAt] || ''),
      total_quota_remaining: Number(got[storageKeys.licenseRemaining] ?? 0),
    };
  }
}

/** 扣减配额（n 次），返回剩余次数；-1 表示不限次。 */
export async function consumeQuota(n = 1): Promise<number> {
  if (DIRECT_MODE) return 9999;
  const token = await getToken();
  if (!token) throw new AuthExpiredError('尚未激活，请先输入卡密');
  const data = await call<{ consumed: number; remaining: number | null }>('consume', { token, n });
  await client.set({ [storageKeys.licenseRemaining]: data.remaining });
  return data.remaining === null ? -1 : data.remaining;
}

export async function getUserQuotas() {
  const info = await checkQuota();
  if (!info.is_active) return { quotas: [] as unknown[] };
  return {
    quotas: [
      {
        plan: info.membership_type,
        expires_at: info.membership_expires_at,
        remaining: info.total_quota_remaining,
      },
    ],
  };
}

/** 卸载/退出授权：通知服务端解绑并清本地 token。 */
export async function deactivate(): Promise<void> {
  const token = await getToken();
  if (token) {
    try {
      await call('deactivate', { token });
    } catch {
      /* 网络异常也照常清本地 */
    }
  }
  await clearAuth();
}

/* ---------- 以下为产物原有导出面（保留调用签名，避免其它模块编译失败） ---------- */

export async function getMediaViaBackend(): Promise<never> {
  throw new Error('直连模式无需后端');
}

export const commitMedia = async (mediaId?: string) => {
  const remaining = await consumeQuota(1);
  return { ok: true as const, mediaId, remaining };
};

export const releaseMedia = async (mediaId?: string) => ({ ok: true as const, mediaId });

export const DIRECT_MODE_BUILD = DIRECT_MODE;
