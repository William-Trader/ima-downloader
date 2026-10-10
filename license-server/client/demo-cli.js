#!/usr/bin/env node
/**
 * qc-license 演示客户端（原创 demo）
 * 用法: node demo-cli.js <服务器地址> [卡密]
 * 例:   node demo-cli.js http://YOUR-LICENSE-HOST:8899 QC-XXXX-XXXX-XXXX-XXXX
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const BASE = (process.argv[2] || 'http://127.0.0.1:8899').replace(/\/$/, '');
const CODE = process.argv[3] || '';
const STATE = path.join(os.homedir(), '.qc-demo-client.json');

const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};
function save() { fs.writeFileSync(STATE, JSON.stringify(state, null, 2), { mode: 0o600 }); }
fs.mkdirSync(path.dirname(STATE), { recursive: true });

function deviceId() {
  if (!state.device_id) {
    state.device_id = 'demo-' + crypto.createHash('sha256').update(os.hostname() + os.platform() + os.arch() + os.homedir()).digest('hex').slice(0, 20);
    save();
  }
  return state.device_id;
}
async function call(api, payload = {}, token) {
  const body = { ...payload, ts: Math.floor(Date.now() / 1000), nonce: crypto.randomBytes(12).toString('hex') };
  if (token) body.token = token;
  const r = await fetch(BASE + '/api/v1/' + api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const raw = await r.text();
  const sign = r.headers.get('x-sign');
  const j = JSON.parse(raw);
  return { ok: r.ok && j.ok !== false, status: r.status, data: j, sign };
}
const line = (k, v) => console.log('  ' + k.padEnd(14) + v);

(async () => {
  console.log('服务器: ' + BASE);
  const did = deviceId();
  line('设备号', did);
  line('本地状态', state.token ? '已授权（token 已缓存）' : '未授权');

  if (!state.token && !CODE) { console.log('\n提示: 传入卡密即可激活 → node demo-cli.js ' + BASE + ' QC-XXXX-...'); process.exit(0); }

  if (!state.token) {
    console.log('\n[1/4] 注册设备');
    const reg = await call('register', { device_id: did, name: os.hostname() });
    line('结果', reg.ok ? 'ok' : reg.data.message || reg.status);

    console.log('[2/4] 激活卡密 ' + CODE);
    const act = await call('activate', { code: CODE, device_id: did, device_name: os.hostname() });
    if (!act.ok) { line('失败', act.data.error + ' · ' + act.data.message); process.exit(1); }
    state.token = act.data.data.token; save();
    line('套餐', act.data.data.plan);
    line('到期', act.data.data.expires_at ? new Date(act.data.data.expires_at * 1000).toLocaleString('zh-CN') : '永久');
    line('剩余次数', act.data.data.remaining === null ? '不限' : act.data.data.remaining);
    line('响应签名', act.sign ? act.sign.slice(0, 16) + '…' : '(无)');
  }
  console.log('\n[3/4] 心跳校验（模拟插件在线）');
  const hb = await call('heartbeat', { device_id: did }, state.token);
  if (!hb.ok) { line('失败', hb.data.error + ' · ' + hb.data.message); }
  else {
    line('状态', hb.data.data.status);
    line('套餐', hb.data.data.plan);
    line('剩余次数', hb.data.data.remaining === null ? '不限' : hb.data.data.remaining);
  }
  console.log('[4/4] 消耗一次配额');
  const cs = await call('consume', { device_id: did, n: 1 }, state.token);
  line('结果', cs.ok ? ('已用 1 次，剩余 ' + (cs.data.data.remaining === null ? '不限' : cs.data.data.remaining)) : (cs.data.error + ' · ' + cs.data.message));
  console.log('\n完成。解绑请运行: node demo-cli.js ' + BASE + ' --deactivate');
  if (process.argv[3] === '--deactivate') {
    const d = await call('deactivate', { device_id: did }, state.token);
    line('解绑', d.ok ? 'ok' : d.data.message);
    delete state.token; save();
  }
})().catch(e => { console.error('异常:', e.message); process.exit(1); });
