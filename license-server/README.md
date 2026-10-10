# qc-license · 授权/卡密系统（原创）

给自有软件/扩展做**正版授权**的后端：卡密生成与管理 + 激活校验 + 设备绑定 + 配额。

- 服务端：Node 内置模块（`node:http` / `node:sqlite` / `node:crypto`），**零 npm 依赖**
- 商家后台：`public/index.html` 单页控制台（卡密制作 / 卡密管理 / 设备管理 / 数据概览）
- 演示客户端：`client/demo-cli.js`（CLI）、`extension-demo/`（MV3 扩展）
- 接口契约：`SPEC.md`

## 本地跑
```bash
DATA_DIR=./data PORT=8899 node server.js
# 管理口令首次启动随机生成，写入 data/admin.password
cat data/admin.password
```

## 接口速览
- 后台：`/api/admin/login|stats|cards|cards/generate|devices|export`
- 客户端：`/api/v1/register|activate|heartbeat|consume|deactivate`

## 安全设计
- 管理口令 timingSafeEqual 比对；后台 token = HMAC 签名载荷（无状态、可设 TTL）
- 客户端接口：`ts` ±300s 窗口 + `nonce` 一次性（防重放）
- 响应带 `X-Sign`（HMAC-SHA256），客户端可校验完整性
- 设备绑定：一卡一设备，可后台解绑/吊销（吊销后心跳立即失败）

> 生产建议：前面挂 TLS（Caddy/Nginx）+ 域名；口令与 secret 落在 `data/`（0600）。
