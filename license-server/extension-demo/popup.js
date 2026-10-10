const $ = (s) => document.querySelector(s);
chrome.storage.local.get(['base','device_id','token','last_status'], (s) => {
  $('base').value = s.base || 'http://127.0.0.1:8899';
  if (!s.device_id) { const id = 'ext-' + crypto.randomUUID().slice(0,18); chrome.storage.local.set({device_id:id}); }
  $('st').textContent = s.token ? ('已授权 · 最近状态: ' + (s.last_status||'-')) : '未激活';
});
function nid(){return crypto.getRandomValues(new Uint8Array(12)).reduce((s,b)=>s+b.toString(16).padStart(2,'0'),'');}
$('go').onclick = async () => {
  const base = $('base').value.replace(/\/$/,'');
  const code = $('code').value.trim().toUpperCase();
  const s = await chrome.storage.local.get(['device_id']);
  $('st').textContent = '激活中…';
  try {
    const body = { code, device_id: s.device_id, device_name: navigator.userAgent.slice(0,40), ts: Math.floor(Date.now()/1000), nonce: nid() };
    const r = await fetch(base + '/api/v1/activate', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const j = await r.json();
    if (!j.ok) { $('st').textContent = '失败: ' + j.error + ' · ' + j.message; return; }
    await chrome.storage.local.set({ base, token: j.data.token, last_status: 'active' });
    $('st').textContent = '激活成功\n套餐: ' + j.data.plan + '\n到期: ' + (j.data.expires_at ? new Date(j.data.expires_at*1000).toLocaleString('zh-CN') : '永久') + '\n剩余: ' + (j.data.remaining === null ? '不限' : j.data.remaining);
  } catch (e) { $('st').textContent = '网络错误: ' + e.message; }
};
