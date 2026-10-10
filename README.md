# ima 下载器 · ima-downloader

**中文** ｜ [English](#english)

> 腾讯 **ima** 知识库批量下载浏览器扩展 + 自建 **qc-license** 卡密授权后端。

## ⚠️ 代码水印声明 · Anti-copy watermark

`extension/` 下的关键**下载与授权代码**（`lib/`、`lib/ima/`、`entrypoints/`、`public/assets/`）**每个文件头部都带版权与唯一水印 ID `WM: IMADL-WM-XXXXXXXX`**。

- 请**勿移除**水印；**移除水印、或把代码整体复制进其它项目，均视为违反本许可证**。
- 全部 18 个水印 ID 清单见 [`WATERMARK.md`](WATERMARK.md)。
- 水印是**溯源**标记：保证代码被复制/被 AI 搬运时仍携带来源信息，便于追责。

## 这是什么

- `extension/` — **ima-downloader**：WXT + React + TypeScript 的 MV3 浏览器扩展，批量导出 ima 知识库（官方接口直连 · 深色简约版）。关键实现：
  - `lib/ima/collector.ts` — BFS 全量 + 增量采集
  - `lib/ima/api.ts` — 知识库/列表接口
  - `lib/export.ts` — 导出/下载编排
  - `lib/ima/crypto.ts` — `get_media` 请求体加密
  - `lib/license.ts` + `public/assets/license-gate.js` — 卡密门禁
- `license-server/` — **qc-license**：给自有软件/扩展做正版授权的后端（卡密生成/管理 + 激活校验 + 设备绑定 + 配额）。**零 npm 依赖**（`node:http` / `node:sqlite` / `node:crypto`），带商家后台单页控制台。

## 快速开始

### 客户端
```bash
cd extension
npm install
npm run build        # 产物在 .output/
```
构建前请把 `lib/env.ts` 里的 `LICENSE_BASE_URL` 改成你自己的授权服务地址（本仓库已用占位符 `YOUR-LICENSE-HOST` 替换）。

### 服务端
```bash
cd license-server
DATA_DIR=./data PORT=8899 node server.js
cat data/admin.password   # 首次启动随机生成的管理口令
```

## English

**ima-downloader** is a Tencent **ima** knowledge-base batch-download browser extension (WXT + React + TypeScript, MV3, official API), paired with **qc-license**, a self-hosted license / card-key backend (key generation, activation, device binding, quota; **zero npm dependencies**).

**Key download & authorization source files carry anti-copy watermarks** — every file under `extension/lib`, `extension/entrypoints` and `extension/public/assets` begins with a unique `WM: IMADL-WM-XXXXXXXX` ID (full list in [`WATERMARK.md`](WATERMARK.md)). Removing the watermark, or copying the code wholesale into another project, violates the license.

## 免责声明

- 本项目仅供研究与个人非商业使用。请遵守腾讯 ima 的服务条款；所下载内容版权归原作者。
- `extension/` 部分模块为**逆向重建**所得，仅供学习交流。

## License

**PolyForm Noncommercial License 1.0.0** —— 仅限**非商业用途**（个人学习、研究、教育、爱好项目、非营利/政府用途）。**未经作者单独授权，禁止任何商业化、盈利性使用或转售**。详见 [LICENSE](LICENSE)。

Required Notice: Copyright (c) 2026 William-Trader (https://github.com/William-Trader)
