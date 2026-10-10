# qc-license 授权/卡密系统 — 接口契约 v1

## 通用
- 基址: http://<host>:8899
- 编码: JSON / UTF-8
- 防重放: 客户端请求体带 `ts`(秒) 与 `nonce`(随机串)，服务端窗口 ±300s 且 nonce 不可复用
- 响应签名: 头 `X-Sign: hmac-sha256(secret, rawBody)`（客户端可校验）

## 商家后台 API（Bearer: 登录返回的 token）
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/admin/login | {password} → {token, expires_at} |
| GET  | /api/admin/stats | 总览：卡密数/未用/已激活/已吊销/设备数/今日激活 |
| POST | /api/admin/cards/generate | {plan:{name,days,uses}, count, note, batch} → {batch, cards[]} |
| GET  | /api/admin/cards | ?status=&batch=&q=&page=&size= → {total, items[]} |
| POST | /api/admin/cards/:code/revoke | 吊销 |
| POST | /api/admin/cards/:code/unbind | 解绑设备 |
| POST | /api/admin/cards/:code/note | `{note}` → 设置/清空备注（≤200 字，用于记录买家信息） |
| POST | /api/admin/cards/:code/delete | `{confirm:"<卡密>"}` → 硬删除卡密（必填二次确认；已绑定设备会一并解绑） |
| GET  | /api/admin/devices | ?page=&size= → 设备列表 |
| GET  | /api/admin/export?batch= | CSV 导出 |

## 客户端 API（插件/客户端调用）
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/v1/register | {device_id, name, ts, nonce} → {ok, ts} |
| POST | /api/v1/activate | {code, device_id, device_name, ts, nonce} → {ok, data:{plan, expires_at, token, remaining}} |
| POST | /api/v1/heartbeat | {device_id, token, ts, nonce} → {ok, data:{expires_at, remaining, status}} |
| POST | /api/v1/deactivate | {device_id, token, ts, nonce} → {ok} |

## 卡密规则
- 状态机: unused → activated → (expired | revoked)
- 一个卡密绑定一台设备；`days=0` 表示永久；`uses=0` 表示不限次
- 卡密格式: QC-XXXX-XXXX-XXXX-XXXX（Crockford base32，去除易混字符）
