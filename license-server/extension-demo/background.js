// qc-license demo · 后台心跳
const DEFAULT_BASE = 'http://127.0.0.1:8899';
async function cfg() { return (await chrome.storage.local.get(['base','device_id','token'])); }
function rid() { return crypto.getRandomValues(new Uint8Array(12)).reduce((s,b)=>s+b.toString(16).padStart(2,'0'),''); }
async function call(api, payload = {}) {
  const { base, device_id } = await cfg();
  const body = { ...payload, device_id, ts: Math.floor(Date.now()/1000), nonce: rid() };
  const r = await fetch((base || DEFAULT_BASE) + '/api/v1/' + api, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  return await r.json();
}
chrome.runtime.onInstalled.addListener(async () => {
  const s = await cfg();
  if (!s.base) await chrome.storage.local.set({ base: DEFAULT_BASE });
  chrome.alarms.create('hb', { periodInMinutes: 30 });
});
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== 'hb') return;
  const s = await cfg();
  if (!s.token) return;
  try {
    const j = await call('heartbeat', { token: s.token });
    await chrome.storage.local.set({ last_heartbeat: Date.now(), last_status: j.ok ? 'active' : (j.error || 'error') });
    if (!j.ok && (j.error === 'CARD_EXPIRED' || j.error === 'CARD_REVOKED' || j.error === 'UNAUTHORIZED')) {
      await chrome.storage.local.remove('token');
    }
  } catch (e) { await chrome.storage.local.set({ last_status: 'network_error' }); }
});
