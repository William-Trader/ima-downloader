/*!
 * lib/env.ts — ima-downloader 关键下载/授权逻辑
 * © 2026 William-Trader (https://github.com/William-Trader/ima-downloader)
 * WM: IMADL-WM-02160E92
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * 依据 PolyForm Noncommercial 1.0.0：仅限非商业用途，禁止任何商业化使用。
 * 本文件含防拷贝水印标记，请勿删除；移除即视为违反许可证。
 */
/** 逆向重建：产物中每处入口都以 `globalThis.browser?.runtime?.id ? browser : chrome` 选择 API 命名空间。 */
export const browser = (
  (globalThis as any).browser?.runtime?.id ? (globalThis as any).browser : (globalThis as any).chrome
) as typeof chrome;

/**
 * 直连/授权模式分叉开关。
 *  - true  = 旧「直连模式」：不校验授权，配额恒为 9999（原始逆向重建产物行为）
 *  - false = 接入清尘服务器 qc-license 卡密授权（注册 / 激活 / 心跳 / 配额扣减）
 */
export const DIRECT_MODE = false;

/** 授权服务基址：清尘服务器（阿里云 YOUR-LICENSE-HOST:8899，qc-license v1 协议）。 */
export const LICENSE_BASE_URL = 'http://YOUR-LICENSE-HOST:8899';
