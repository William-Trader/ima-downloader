#!/usr/bin/env node
/**
 * qc-license — 授权/卡密服务（原创实现，零 npm 依赖）
 * 依赖: node:http / node:sqlite / node:crypto（Node >= 22.5）
 * 用法: PORT=8899 DATA_DIR=/opt/qc-license/data node server.js
 */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const PORT = Number(process.env.PORT || 8899);
const HOST = process.env.HOST || '0.0.0.0';
const TOKEN_TTL = Number(process.env.ADMIN_TOKEN_TTL || 12 * 3600);
const REPLAY_WINDOW = 300; // 秒

fs.mkdirSync(DATA_DIR, { recursive: true });

function secret(name, bytes) {
  const f = path.join(DATA_DIR, name);
  if (process.env[name.toUpperCase()]) return process.env[name.toUpperCase()];
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  const v = crypto.randomBytes(bytes).toString('hex');
  fs.writeFileSync(f, v, { mode: 0o600 });
  return v;
}
const SECRET = secret('secret', 32);
const ADMIN_PASSWORD = (() => {
  const f = path.join(DATA_DIR, 'admin.password');
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  const v = 'qc-' + crypto.randomBytes(5).toString('hex');
  fs.writeFileSync(f, v, { mode: 0o600 });
  return v;
})();

const db = new DatabaseSync(path.join(DATA_DIR, 'license.db'));
db.exec(`
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS cards(
  code TEXT PRIMARY KEY, plan_name TEXT, days INTEGER, uses INTEGER,
  batch TEXT, note TEXT, status TEXT DEFAULT 'unused',
  created_at INTEGER, activated_at INTEGER, expires_at INTEGER,
  device_id TEXT, used_count INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS devices(
  device_id TEXT PRIMARY KEY, name TEXT, token TEXT, card_code TEXT,
  first_seen INTEGER, last_seen INTEGER, ip TEXT);
CREATE TABLE IF NOT EXISTS logs(
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, action TEXT, detail TEXT, ip TEXT);
CREATE TABLE IF NOT EXISTS nonces(nonce TEXT PRIMARY KEY, ts INTEGER);
CREATE INDEX IF NOT EXISTS idx_cards_status ON cards(status);
CREATE INDEX IF NOT EXISTS idx_cards_batch ON cards(batch);
`);

const q = {
  insertCard: db.prepare(`INSERT INTO cards(code,plan_name,days,uses,batch,note,status,created_at)
    VALUES(?,?,?,?,?,?,'unused',?)`),
  card: db.prepare('SELECT * FROM cards WHERE code=?'),
  cardByDevice: db.prepare('SELECT * FROM cards WHERE device_id=?'),
  device: db.prepare('SELECT * FROM devices WHERE device_id=?'),
  insertDevice: db.prepare(`INSERT INTO devices(device_id,name,token,card_code,first_seen,last_seen,ip)
    VALUES(?,?,?,?,?,?,?)`),
  touchDevice: db.prepare('UPDATE devices SET last_seen=? WHERE device_id=?'),
  updateDeviceToken: db.prepare('UPDATE devices SET token=?, name=COALESCE(?,name), ip=? WHERE device_id=?'),
  log: db.prepare('INSERT INTO logs(ts,action,detail,ip) VALUES(?,?,?,?)'),
  nonce: db.prepare('INSERT OR IGNORE INTO nonces(nonce,ts) VALUES(?,?)'),
  nonceClean: db.prepare('DELETE FROM nonces WHERE ts < ?'),
};

// ---------- utils ----------
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford
function randStr(n, alphabet = ALPHABET) {
  const b = crypto.randomBytes(n); let s = '';
  for (let i = 0; i < n; i++) s += alphabet[b[i] % alphabet.length];
  return s;
}
function newCode() {
  return 'QC-' + [0,1,2,3].map(() => randStr(4)).join('-');
}
function hmac(data) { return crypto.createHmac('sha256', SECRET).update(data).digest('hex'); }
function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body + '.' + hmac(body).slice(0, 32);
}
function verifyToken(tok) {
  if (typeof tok !== 'string' || !tok.includes('.')) return null;
  const [body, sig] = tok.split('.');
  if (hmac(body).slice(0, 32) !== sig) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!p.exp || p.exp < Math.floor(Date.now() / 1000)) return null;
    return p;
  } catch { return null; }
}
function expireCards() {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`UPDATE cards SET status='expired' WHERE status='activated' AND expires_at>0 AND expires_at<?`).run(now);
}
function cardView(c) {
  if (!c) return null;
  const now = Math.floor(Date.now() / 1000);
  const expired = c.expires_at > 0 && c.expires_at < now;
  return {
    code: c.code, plan: c.plan_name, days: c.days, uses: c.uses,
    remaining: c.uses > 0 ? Math.max(0, c.uses - c.used_count) : null,
    status: expired && c.status === 'activated' ? 'expired' : c.status,
    batch: c.batch, note: c.note,
    created_at: c.created_at, activated_at: c.activated_at, expires_at: c.expires_at,
    device_id: c.device_id, used: c.used_count,
  };
}
function expiresFor(days) {
  if (!days || days <= 0) return 0; // 永久
  return Math.floor(Date.now() / 1000) + days * 86400;
}
function dayStart() {
  const d = new Date(); d.setHours(0, 0, 0, 0); return Math.floor(d.getTime() / 1000);
}

function readBody(req, limit = 1 << 20) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function send(res, status, obj, { signed = false, csrf } = {}) {
  const body = Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj));
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' };
  headers['Access-Control-Allow-Origin'] = '*';
  headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization';
  headers['Access-Control-Allow-Methods'] = 'GET,POST,OPTIONS';
  if (signed) headers['X-Sign'] = hmac(body);
  res.writeHead(status, headers); res.end(body);
}
function err(res, status, code, msg, extra) { send(res, status, { ok: false, error: code, message: msg, ...(extra || {}) }); }

// 防重放
function checkReplay(b, ip) {
  const ts = Number(b && b.ts), nonce = b && b.nonce;
  const now = Math.floor(Date.now() / 1000);
  if (!ts || Math.abs(now - ts) > REPLAY_WINDOW) return '时间戳超出窗口';
  if (typeof nonce !== 'string' || nonce.length < 8 || nonce.length > 64) return 'nonce 非法';
  q.nonceClean.run(now - REPLAY_WINDOW * 2);
  const r = q.nonce.run(nonce, now);
  if (r.changes === 0) return 'nonce 已被使用（重放）';
  return null;
}
function adminAuth(req) {
  const h = req.headers['authorization'] || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
  return verifyToken(tok);
}
function audit(action, detail, ip) { q.log.run(Math.floor(Date.now() / 1000), action, detail, ip || ''); }
function clientIp(req) { return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || ''; }

// ---------- 商家后台 ----------
function adminLogin(body) {
  const a = Buffer.from(String(body.password || '')); const b = Buffer.from(ADMIN_PASSWORD);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL;
  return { token: signToken({ role: 'admin', exp }), expires_at: exp };
}
function adminGenerate(body) {
  const plan = body.plan || {};
  const name = String(plan.name || '自定义套餐').slice(0, 40);
  const days = Math.max(0, parseInt(plan.days ?? 30, 10) || 0);
  const uses = Math.max(0, parseInt(plan.uses ?? 0, 10) || 0);
  const count = Math.min(1000, Math.max(1, parseInt(body.count ?? 1, 10) || 1));
  const batch = String(body.batch || (new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + randStr(4))).slice(0, 40);
  const note = String(body.note || '').slice(0, 200);
  const now = Math.floor(Date.now() / 1000);
  const codes = [];
  for (let i = 0; i < count; i++) {
    for (let t = 0; t < 5; t++) {
      const code = newCode();
      try { q.insertCard.run(code, name, days, uses, batch, note, now); codes.push(code); break; }
      catch (e) { if (t === 4) throw e; }
    }
  }
  return { ok: true, batch, count: codes.length, plan: { name, days, uses }, codes };
}
function adminStats() {
  expireCards();
  const now = Math.floor(Date.now() / 1000);
  const g = (sql, ...a) => db.prepare(sql).get(...a);
  return {
    ok: true,
    total: g('SELECT COUNT(*) c FROM cards').c,
    unused: g("SELECT COUNT(*) c FROM cards WHERE status='unused'").c,
    activated: g("SELECT COUNT(*) c FROM cards WHERE status='activated'").c,
    expired: g("SELECT COUNT(*) c FROM cards WHERE status='expired'").c,
    revoked: g("SELECT COUNT(*) c FROM cards WHERE status='revoked'").c,
    devices: g('SELECT COUNT(*) c FROM devices').c,
    online_24h: g('SELECT COUNT(*) c FROM devices WHERE last_seen>?', now - 86400).c,
    today_activated: g('SELECT COUNT(*) c FROM cards WHERE activated_at>=?', dayStart()).c,
  };
}
function adminCards(url) {
  expireCards();
  const status = url.searchParams.get('status') || '';
  const batch = url.searchParams.get('batch') || '';
  const kw = (url.searchParams.get('q') || '').trim();
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const size = Math.min(200, Math.max(1, parseInt(url.searchParams.get('size') || '20', 10)));
  const where = [], args = [];
  if (status) { where.push('status=?'); args.push(status); }
  if (batch) { where.push('batch=?'); args.push(batch); }
  if (kw) { where.push('(code LIKE ? OR note LIKE ? OR device_id LIKE ?)'); args.push('%'+kw+'%','%'+kw+'%','%'+kw+'%'); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare('SELECT COUNT(*) c FROM cards ' + w).get(...args).c;
  const rows = db.prepare('SELECT * FROM cards ' + w + ' ORDER BY created_at DESC, code DESC LIMIT ? OFFSET ?').all(...args, size, (page - 1) * size);
  const batches = db.prepare('SELECT batch, COUNT(*) c FROM cards GROUP BY batch ORDER BY MAX(created_at) DESC LIMIT 50').all();
  return { ok: true, total, page, size, items: rows.map(cardView), batches };
}
function adminDevices(url) {
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const size = Math.min(200, Math.max(1, parseInt(url.searchParams.get('size') || '20', 10)));
  const total = db.prepare('SELECT COUNT(*) c FROM devices').get().c;
  const rows = db.prepare('SELECT d.*, c.plan_name, c.status, c.expires_at FROM devices d LEFT JOIN cards c ON c.code=d.card_code ORDER BY d.last_seen DESC LIMIT ? OFFSET ?').all(size, (page - 1) * size);
  return { ok: true, total, page, size, items: rows.map((d) => ({
    device_id: d.device_id, name: d.name, card: d.card_code, plan: d.plan_name,
    status: d.status, expires_at: d.expires_at, first_seen: d.first_seen, last_seen: d.last_seen, ip: d.ip,
  })) };
}
function adminExport(url) {
  expireCards();
  const batch = url.searchParams.get('batch') || '';
  const rows = batch
    ? db.prepare('SELECT * FROM cards WHERE batch=? ORDER BY created_at DESC').all(batch)
    : db.prepare('SELECT * FROM cards ORDER BY created_at DESC').all();
  const head = '卡密,套餐,天数,次数,剩余,状态,批次,备注,绑定设备,激活时间,到期时间';
  const lines = rows.map((c) => {
    const v = cardView(c);
    const dt = (t) => (t ? new Date(t * 1000).toISOString().replace('T', ' ').slice(0, 19) : '');
    return [v.code, v.plan, v.days, v.uses, v.remaining ?? '不限', v.status, v.batch, v.note, v.device_id || '', dt(v.activated_at), v.expires_at ? dt(v.expires_at) : '永久']
      .map((x) => '"' + String(x).replace(/"/g, '""') + '"').join(',');
  });
  return '\ufeff' + [head, ...lines].join('\n');
}

// ---------- 客户端 ----------
function cRegister(b, ip) {
  if (!b.device_id) return { status: 400, body: { ok: false, error: 'BAD_REQUEST', message: '缺少 device_id' } };
  const now = Math.floor(Date.now() / 1000);
  const d = q.device.get(b.device_id);
  if (d) q.touchDevice.run(now, b.device_id);
  else q.insertDevice.run(b.device_id, String(b.name || '').slice(0, 60), '', null, now, now, ip);
  return { status: 200, body: { ok: true, data: { device_id: b.device_id, registered: !d }, ts: now } };
}
function cActivate(b, ip) {
  const code = String(b.code || '').trim().toUpperCase();
  const deviceId = String(b.device_id || '').trim();
  if (!code || !deviceId) return { status: 400, body: { ok: false, error: 'BAD_REQUEST', message: '缺少卡密或设备号' } };
  expireCards();
  const card = q.card.get(code);
  if (!card) return { status: 404, body: { ok: false, error: 'CARD_NOT_FOUND', message: '卡密不存在' } };
  if (card.status === 'revoked') return { status: 403, body: { ok: false, error: 'CARD_REVOKED', message: '卡密已被吊销' } };
  if (card.device_id && card.device_id !== deviceId) return { status: 409, body: { ok: false, error: 'CARD_BOUND', message: '卡密已绑定其他设备，请联系商家解绑' } };
  const now = Math.floor(Date.now() / 1000);
  let exp = card.expires_at;
  if (card.status === 'unused' || !exp) exp = expiresFor(card.days);
  db.prepare(`UPDATE cards SET status='activated', device_id=?, activated_at=COALESCE(activated_at,?), expires_at=? WHERE code=?`).run(deviceId, now, exp, code);
  const token = randStr(40, '0123456789abcdef');
  const dev = q.device.get(deviceId);
  if (dev) q.updateDeviceToken.run(token, b.device_name || null, ip, deviceId);
  else q.insertDevice.run(deviceId, String(b.device_name || '').slice(0, 60), token, code, now, now, ip);
  db.prepare('UPDATE devices SET card_code=? WHERE device_id=?').run(code, deviceId);
  audit('activate', code + ' @ ' + deviceId, ip);
  const c2 = q.card.get(code);
  return { status: 200, body: { ok: true, data: { token, plan: c2.plan_name, days: c2.days, expires_at: c2.expires_at, remaining: c2.uses > 0 ? Math.max(0, c2.uses - c2.used_count) : null, device_id: deviceId } } };
}
function cHeartbeat(b, ip) {
  const dev = q.device.get(String(b.device_id || ''));
  if (!dev || !dev.token || dev.token !== b.token) return { status: 401, body: { ok: false, error: 'UNAUTHORIZED', message: '设备未授权或令牌失效' } };
  expireCards();
  const card = dev.card_code ? q.card.get(dev.card_code) : null;
  if (!card) return { status: 404, body: { ok: false, error: 'NO_CARD', message: '该设备未绑定卡密' } };
  if (card.status === 'revoked') return { status: 403, body: { ok: false, error: 'CARD_REVOKED', message: '卡密已被吊销' } };
  const now = Math.floor(Date.now() / 1000);
  if (card.expires_at > 0 && card.expires_at < now) return { status: 403, body: { ok: false, error: 'CARD_EXPIRED', message: '卡密已到期' } };
  const remaining = card.uses > 0 ? Math.max(0, card.uses - card.used_count) : null;
  if (remaining === 0) return { status: 403, body: { ok: false, error: 'QUOTA_EXHAUSTED', message: '配额不足，请联系管理员充值' }, };
  q.touchDevice.run(now, dev.device_id);
  return { status: 200, body: { ok: true, data: { plan: card.plan_name, status: 'active', expires_at: card.expires_at, remaining, server_ts: now } } };
}
function cConsume(b, ip) {
  const n = Math.min(1000, Math.max(1, parseInt(b.n ?? 1, 10) || 1));
  const dev = q.device.get(String(b.device_id || ''));
  if (!dev || !dev.token || dev.token !== b.token) return { status: 401, body: { ok: false, error: 'UNAUTHORIZED', message: '设备未授权或令牌失效' } };
  expireCards();
  const card = dev.card_code ? q.card.get(dev.card_code) : null;
  if (!card || card.status !== 'activated') return { status: 403, body: { ok: false, error: 'NOT_ACTIVE', message: '卡密未激活或已失效' } };
  if (card.expires_at > 0 && card.expires_at < Math.floor(Date.now() / 1000)) return { status: 403, body: { ok: false, error: 'CARD_EXPIRED', message: '卡密已到期' } };
  if (card.uses > 0) {
    const remaining = card.uses - card.used_count;
    if (remaining < n) return { status: 402, body: { ok: false, error: 'QUOTA_EXHAUSTED', message: '配额不足，请联系管理员充值', remaining } };
    db.prepare('UPDATE cards SET used_count=used_count+? WHERE code=?').run(n, card.code);
  }
  const c2 = q.card.get(card.code);
  return { status: 200, body: { ok: true, data: { consumed: n, remaining: c2.uses > 0 ? Math.max(0, c2.uses - c2.used_count) : null } } };
}
function cDeactivate(b, ip) {
  const dev = q.device.get(String(b.device_id || ''));
  if (!dev || !dev.token || dev.token !== b.token) return { status: 401, body: { ok: false, error: 'UNAUTHORIZED', message: '设备未授权' } };
  db.prepare('UPDATE devices SET token=? WHERE device_id=?').run('', dev.device_id);
  audit('deactivate', dev.device_id, ip);
  return { status: 200, body: { ok: true, message: '已解绑本机授权（卡密仍可重新激活）' } };
}

// ---------- 静态 & 路由 ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  rel = rel.replace(/\.\./g, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  const body = fs.readFileSync(file);
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Length': body.length });
  res.end(body); return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const ip = clientIp(req);
  if (req.method === 'OPTIONS') return send(res, 204, {});
  try {
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) return serveStatic(req, res, '/index.html');
    if (req.method === 'GET' && p === '/health') return send(res, 200, { ok: true, ts: Math.floor(Date.now() / 1000), service: 'qc-license' });
    if (req.method === 'GET' && serveStatic(req, res, p)) return;

    const needJson = ['POST', 'PUT', 'PATCH'].includes(req.method);
    let body = {};
    if (needJson) {
      const raw = await readBody(req);
      if (raw.length) { try { body = JSON.parse(raw.toString('utf8')); } catch { return err(res, 400, 'BAD_JSON', '请求体不是合法 JSON'); } }
    }

    // ---- 客户端 ----
    if (p.startsWith('/api/v1/')) {
      const action = p.slice('/api/v1/'.length);
      if (action !== 'register') {
        const rp = checkReplay(body, ip);
        if (rp) return err(res, 400, 'REPLAY', rp);
      }
      const map = { register: cRegister, activate: cActivate, heartbeat: cHeartbeat, consume: cConsume, deactivate: cDeactivate };
      const fn = map[action];
      if (!fn) return err(res, 404, 'NOT_FOUND', '未知接口');
      const r = fn(body, ip);
      return send(res, r.status, r.body, { signed: true });
    }

    // ---- 商家后台 ----
    if (p === '/api/admin/login' && req.method === 'POST') {
      const r = adminLogin(body);
      if (!r) { audit('login_fail', '', ip); return err(res, 401, 'BAD_PASSWORD', '口令错误'); }
      audit('login_ok', '', ip);
      return send(res, 200, { ok: true, ...r });
    }
    if (p.startsWith('/api/admin/')) {
      if (!adminAuth(req)) return err(res, 401, 'UNAUTHORIZED', '请先登录');
      if (p === '/api/admin/stats' && req.method === 'GET') return send(res, 200, adminStats());
      if (p === '/api/admin/cards' && req.method === 'GET') return send(res, 200, adminCards(url));
      if (p === '/api/admin/cards/generate' && req.method === 'POST') { const r = adminGenerate(body); audit('generate', r.batch + ' x' + r.count, ip); return send(res, 200, r); }
      if (p === '/api/admin/devices' && req.method === 'GET') return send(res, 200, adminDevices(url));
      if (p === '/api/admin/export' && req.method === 'GET') {
        const csv = adminExport(url);
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="cards.csv"' });
        return res.end(csv);
      }
      const m = p.match(/^\/api\/admin\/cards\/([^/]+)\/(revoke|unbind|note|delete)$/);
      if (m && req.method === 'POST') {
        const code = decodeURIComponent(m[1]).toUpperCase();
        const card = q.card.get(code);
        if (!card) return err(res, 404, 'CARD_NOT_FOUND', '卡密不存在');
        if (m[2] === 'note') {
          const note = String(body && body.note != null ? body.note : '').replace(/[\r\n\t]/g, ' ').trim().slice(0, 200);
          db.prepare('UPDATE cards SET note=? WHERE code=?').run(note, code);
          audit('note', code + ' | ' + note, ip);
          return send(res, 200, { ok: true, message: note ? '备注已保存' : '备注已清空', code, note });
        }
        if (m[2] === 'delete') {
          if (!body || String(body.confirm || '').toUpperCase() !== code) {
            return err(res, 400, 'CONFIRM_REQUIRED', '删除需回传 confirm=<卡密> 以二次确认');
          }
          const bound = card.device_id;
          db.prepare('DELETE FROM cards WHERE code=?').run(code);
          if (bound) db.prepare("UPDATE devices SET card_code=NULL, token='' WHERE device_id=?").run(bound);
          audit('delete', code + (bound ? ' (device ' + bound + ')' : ''), ip);
          return send(res, 200, { ok: true, message: '卡密已删除' + (bound ? '，已解绑设备' : ''), code });
        }
        if (m[2] === 'revoke') {
          db.prepare("UPDATE cards SET status='revoked' WHERE code=?").run(code);
          const d = q.cardByDevice.get(card.device_id || '');
          if (card.device_id) db.prepare('UPDATE devices SET token=? WHERE device_id=?').run('', card.device_id);
          audit('revoke', code, ip);
          return send(res, 200, { ok: true, message: '已吊销', code });
        }
        db.prepare("UPDATE cards SET device_id=NULL, status=CASE WHEN expires_at>0 AND expires_at<? THEN 'expired' ELSE IFNULL(status,'unused') END WHERE code=?").run(Math.floor(Date.now()/1000), code);
        if (card.device_id) db.prepare('UPDATE devices SET card_code=NULL, token=? WHERE device_id=?').run('', card.device_id);
        audit('unbind', code, ip);
        return send(res, 200, { ok: true, message: '已解绑设备', code });
      }
      return err(res, 404, 'NOT_FOUND', '未知后台接口');
    }
    return err(res, 404, 'NOT_FOUND', 'Not Found');
  } catch (e) {
    console.error('[error]', e);
    return err(res, 500, 'INTERNAL', String(e && e.message || e));
  }
});

server.listen(PORT, HOST, () => {
  console.log('[qc-license] listening on http://' + HOST + ':' + PORT + '  data=' + DATA_DIR);
});
