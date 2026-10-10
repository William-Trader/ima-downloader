#!/usr/bin/env node
/** qc-license 端到端验收（在服务器本机执行） */
'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const BASE = process.env.BASE || 'http://127.0.0.1:8899';
const PW = fs.readFileSync('/opt/qc-license/data/admin.password', 'utf8').trim();
const ok = (b) => (b ? '✅' : '❌');
let fails = 0;
function chk(cond, label, extra) {
  if (!cond) fails++;
  console.log('  ' + ok(cond) + ' ' + label + (extra !== undefined ? ' → ' + extra : ''));
}
async function j(method, path, body, token) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(t), sign: r.headers.get('x-sign') }; }
  catch { return { status: r.status, body: t }; }
}
const rid = () => crypto.randomBytes(9).toString('hex');
const stamp = () => Math.floor(Date.now() / 1000);

(async () => {
  console.log('== qc-license 端到端验收 · ' + BASE + ' ==');
  console.log('\n[1] 商家后台登录');
  const bad = await j('POST', '/api/admin/login', { password: 'wrong-password' });
  chk(bad.status === 401, '错误口令被拒', 'HTTP ' + bad.status);
  const login = await j('POST', '/api/admin/login', { password: PW });
  chk(login.body.ok === true, '正确口令登录成功');
  const TOK = login.body.token;
  const noAuth = await j('GET', '/api/admin/cards');
  chk(noAuth.status === 401, '无 token 访问后台被拒', 'HTTP ' + noAuth.status);

  console.log('\n[2] 卡密制作（生成 5 张月度版）');
  const gen = await j('POST', '/api/admin/cards/generate', { plan: { name: '月度版', days: 30, uses: 0 }, count: 5, note: '演示批次' }, TOK);
  chk(gen.body.ok && gen.body.codes.length === 5, '生成 5 张卡密', gen.body.batch);
  console.log('     示例: ' + gen.body.codes[0]);
  const CODE = gen.body.codes[0];

  console.log('\n[3] 客户端链路（注册 → 激活 → 心跳 → 配额）');
  const DEV = 'verify-' + rid();
  const reg = await j('POST', '/api/v1/register', { device_id: DEV, name: 'verifier', ts: stamp(), nonce: rid() });
  chk(reg.body.ok === true, '设备注册');
  const act = await j('POST', '/api/v1/activate', { code: CODE, device_id: DEV, device_name: 'verifier', ts: stamp(), nonce: rid() });
  chk(act.body.ok === true, '卡密激活', act.body.data && act.body.data.plan);
  chk(!!act.sign, '响应带 X-Sign 签名', act.sign ? act.sign.slice(0, 12) + '…' : '');
  const TOKEN = act.body.data && act.body.data.token;
  const hb = await j('POST', '/api/v1/heartbeat', { device_id: DEV, token: TOKEN, ts: stamp(), nonce: rid() });
  chk(hb.body.ok === true, '心跳校验通过', hb.body.data && hb.body.data.status);
  const cons = await j('POST', '/api/v1/consume', { device_id: DEV, token: TOKEN, n: 1, ts: stamp(), nonce: rid() });
  chk(cons.body.ok === true, '配额消耗 1 次');
  const replay = await j('POST', '/api/v1/heartbeat', { device_id: DEV, token: TOKEN, ts: stamp(), nonce: 'fixed-nonce-1234' });
  const replay2 = await j('POST', '/api/v1/heartbeat', { device_id: DEV, token: TOKEN, ts: stamp(), nonce: 'fixed-nonce-1234' });
  chk(replay.status === 200 && replay2.body.error === 'REPLAY', 'nonce 防重放生效', replay2.body.error);
  const badTok = await j('POST', '/api/v1/heartbeat', { device_id: DEV, token: 'deadbeef', ts: stamp(), nonce: rid() });
  chk(badTok.status === 401, '伪造 token 被拒', 'HTTP ' + badTok.status);
  const steal = await j('POST', '/api/v1/activate', { code: gen.body.codes[1], device_id: DEV, ts: stamp(), nonce: rid() });
  chk(steal.body.ok === true, '同设备可激活第二张卡（换卡）');
  const rebound = await j('POST', '/api/v1/activate', { code: CODE, device_id: 'other-device-xyz', ts: stamp(), nonce: rid() });
  chk(rebound.status === 409, '一张卡密不能绑两台设备', rebound.body.error);

  console.log('\n[4] 卡密管理（列表 / 批量导出）');
  const list = await j('GET', '/api/admin/cards?size=3', null, TOK);
  chk(list.body.items.length === 3, '卡密列表分页', '共 ' + list.body.total + ' 条');
  list.body.items.forEach((c) => console.log('     ' + c.code + '  ' + c.status + '  ' + (c.device_id || '-')));
  const stats = await j('GET', '/api/admin/stats', null, TOK);
  chk(stats.body.total >= 5, '统计：卡密总数 ' + stats.body.total + ' / 未使用 ' + stats.body.unused + ' / 已激活 ' + stats.body.activated + ' / 设备 ' + stats.body.devices);

  console.log('\n[5] 吊销 → 客户端失效');
  const rev = await j('POST', '/api/admin/cards/' + encodeURIComponent(CODE) + '/revoke', {}, TOK);
  chk(rev.body.ok === true, '后台吊销卡密');
  const hb2 = await j('POST', '/api/v1/heartbeat', { device_id: DEV, token: TOKEN, ts: stamp(), nonce: rid() });
  chk(hb2.status === 403 || hb2.status === 401, '吊销后心跳被拒', hb2.body.error);
  const list2 = await j('GET', '/api/admin/cards?status=revoked', null, TOK);
  chk(list2.body.items.some((c) => c.code === CODE), '列表可筛出已吊销');

  console.log('\n================ 结果：' + (fails === 0 ? '全部通过 ✅' : fails + ' 项失败 ❌') + ' ================');
  console.log('演示卡密: ' + gen.body.codes.join(' '));
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('验收异常:', e); process.exit(2); });
