/*!
 * lib/ima/constants.ts — ima-downloader 关键下载/授权逻辑
 * © 2026 William-Trader (https://github.com/William-Trader/ima-downloader)
 * WM: IMADL-WM-8D991C77
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * 依据 PolyForm Noncommercial 1.0.0：仅限非商业用途，禁止任何商业化使用。
 * 本文件含防拷贝水印标记，请勿删除；移除即视为违反许可证。
 */
/** IMA Web 端版本号（产物常量 Y）。用于 headers 的 WEB-VERSION 与 extension_version。 */
export const IMA_WEB_VERSION = '2.6.15';

/** content script(main world) 把探测到的真实 WEB-VERSION 写回该 DOM 属性，扩展侧再读走。 */
export const IMA_VERSION_ATTR = 'data-ima-export-web-version';

/** IMA 接口基址。 */
export const IMA_ORIGIN = 'https://ima.qq.com';

export const EP = {
  getMedia: IMA_ORIGIN + '/cgi-bin/s/file_manager/get_media', // 安全加密通道
  getMediaPlain: IMA_ORIGIN + '/cgi-bin/file_manager/get_media', // 明文兼容回退
  getKnowledgeList: IMA_ORIGIN + '/cgi-bin/knowledge_tab_reader/get_knowledge_list',
  getKnowledge: IMA_ORIGIN + '/cgi-bin/knowledge_tab_reader/get_knowledge',
  getKnowledgeBaseList: IMA_ORIGIN + '/cgi-bin/knowledge_tab_reader/get_knowledge_base_list',
  getKnowledgeBaseHomePage: IMA_ORIGIN + '/cgi-bin/knowledge_tab_reader/get_knowledge_base_home_page',
  getHomePageData: IMA_ORIGIN + '/cgi-bin/knowledge_tab_reader/get_home_page_data',
  notebookGetDoc: IMA_ORIGIN + '/cgi-bin/notebook/logic/get_doc',
  notebookGetShareDoc: IMA_ORIGIN + '/cgi-bin/notebook/logic/get_share_know_doc',
} as const;

/** IMA 前端用于加密 get_media 请求体的 RSA-OAEP 公钥（SPKI, SHA-256）。原样保留。 */
export const IMA_MEDIA_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAx9h6SY1LO88wRVKdOC5U
tjYTXfMpUqCK22FemW9ba4812nVjF4Va+guoHXdBePkhsQmz94PeqqZiSN/YekiV
CU6HbWivdhKcs6LcYMT+sw4cwtMZ1NOJEkY1ujOWFnmNmpK243wwlf+RwE/L+xOJ
8vy/EBuYDv06M+BbccO832bOpWsOFYPPP5KtOmOaqXq6Fgu1vOrXmQIo0q8WmO09
PvjHLwIruqthV2dBcVI1qMEKejM1SKwzCWb78t+fUsr3OjDqApWma3h10hGKcin4
NIGdfITwmiBmS+R1Mr8P/ssNq0ptvr9+VqUvsJD7ASVCPo9EG658fZYGil6oH5JN
OQIDAQAB
-----END PUBLIC KEY-----`;

/** 本地已登录账号信息在 ima.qq.com 页面 localStorage 中的键。 */
export const IMA_ACCOUNT_LS_KEY = 'ima-universal-local-storage-accountInfo';

/** 微信图片防盗链所需的 Referer 动态规则。 */
export const WECHAT_RULE_ID = 9001;
export const WECHAT_REFERER = 'https://mp.weixin.qq.com/';

/** 内部协议前缀：微信正文/图片在队列中的占位 URL。 */
export const WECHAT_PENDING_PREFIX = '__wechat_pending__:';

/** WXT 生成产物里 background 的 bundle 名（保留以便对照）。 */
export const OFFSCREEN_PATH = '/runtime.html';
