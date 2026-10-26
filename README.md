# ima 下载器 · ima-downloader

**中文** ｜ [English](#english)

> 腾讯 **ima** 知识库批量下载浏览器扩展 + 自建 **qc-license** 卡密授权后端。

## 面向需求 · 项目缘起

腾讯 **ima** 是一个相当优秀的 **AI 知识库共享软件**：文档可沉淀、可检索、可问答、可按知识库共享给团队，把「个人资料」变成了「组织资产」。

但它有一个绕不过去的缺口：**「可见」不等于「可取」**。对于知识库中已经对你可见的文档，ima **没有提供下载 / 批量导出功能**——只能一篇篇点开、手动另存，几十上百篇的库基本无从下手，离线备份、迁移、归档全部卡死。

所以这个项目解决的就是这一件事。技术选型按「能拿到数据 → 能稳定拿全 → 能对外分发」三层来搭：

- **WXT + React 18 + TypeScript（Manifest V3 浏览器扩展）** —— 跑在用户自己的浏览器里，复用已登录会话，在真实页面上下文中直接调用官方接口；不接触账号密码，也不依赖任何第三方服务器中转。
- **官方接口直连 + 逆向重建** —— 还原知识库与目录树接口，复现 `get_media` 的请求体加密（`lib/ima/crypto.ts`），配合 **BFS 全量 + 增量采集**（`lib/ima/collector.ts`），一次遍历把整库结构与文件全部拉全；已下载的自动跳过，后续只补增量。
- **流式导出与失败重试（`lib/export.ts`）** —— 大文件不撑爆内存，弱网/限流可续传，导出结果保留原始目录层级与文件名。
- **Node.js 原生栈零依赖后端（`node:http` + `node:sqlite` + `node:crypto`）** —— 即 `license-server/`（qc-license）：卡密生成、**批发/批次管理**、激活校验、设备绑定、配额控制，附商家后台单页控制台。

最终产出两件东西：**ima 批量下载**扩展，以及**一并开源的卡密批发后台**。

为什么要开源后端？因为只丢一个前端工具，本质上是一次性脚本，作者无法持续投入、用户也拿不到稳定更新；把**授权与分发**这套正经后端骨架公开，一方面让本扩展的分发有据可依，另一方面别人可以直接拿去做自己软件的正版化系统，而不是再重复造一遍轮子。

一句话概括需求：**用户既然有权看到这些文档，就应该有权把它们拿走。**

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

**Why this exists.** Tencent **ima** is an excellent AI knowledge-base sharing product — but it offers **no download or bulk-export for documents that are already visible to you**. Readable is not the same as portable: backing up, migrating or archiving a library of a few hundred docs means opening and saving each one by hand. This project closes that gap with a **WXT + React 18 + TypeScript** MV3 extension that runs inside the user's own logged-in browser session and talks to the official API directly (including a reconstructed `get_media` request-body encryption and BFS full/incremental collection), plus a **zero-dependency Node.js** (`node:http` / `node:sqlite` / `node:crypto`) license backend that we open-sourced so others can license and distribute their own software instead of rebuilding the same card-key plumbing.

**ima-downloader** is a Tencent **ima** knowledge-base batch-download browser extension (WXT + React + TypeScript, MV3, official API), paired with **qc-license**, a self-hosted license / card-key backend (key generation, activation, device binding, quota; **zero npm dependencies**).

**Key download & authorization source files carry anti-copy watermarks** — every file under `extension/lib`, `extension/entrypoints` and `extension/public/assets` begins with a unique `WM: IMADL-WM-XXXXXXXX` ID (full list in [`WATERMARK.md`](WATERMARK.md)). Removing the watermark, or copying the code wholesale into another project, violates the license.

## 免责声明

- 本项目仅供研究与个人非商业使用。请遵守腾讯 ima 的服务条款；所下载内容版权归原作者。
- `extension/` 部分模块为**逆向重建**所得，仅供学习交流。

## License

**PolyForm Noncommercial License 1.0.0** —— 仅限**非商业用途**（个人学习、研究、教育、爱好项目、非营利/政府用途）。**未经作者单独授权，禁止任何商业化、盈利性使用或转售**。详见 [LICENSE](LICENSE)。

Required Notice: Copyright (c) 2026 William-Trader (https://github.com/William-Trader)
