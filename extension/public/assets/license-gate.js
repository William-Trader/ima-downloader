/*!
 * public/assets/license-gate.js — ima-downloader 关键下载/授权逻辑
 * © 2026 William-Trader (https://github.com/William-Trader/ima-downloader)
 * WM: IMADL-WM-E2468017
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * 依据 PolyForm Noncommercial 1.0.0：仅限非商业用途，禁止任何商业化使用。
 * 本文件含防拷贝水印标记，请勿删除；移除即视为违反许可证。
 */
/* 卡密门禁：未绑定卡密前，遮住插件页面；激活后放行（auth-page / kb-list-page 共用）。 */
(async () => {
  const gate = document.getElementById('license-gate');
  const root = document.getElementById('root');
  if (!gate || !root) return;
  const msg = document.getElementById('qc-msg');
  const codeEl = document.getElementById('qc-code');
  const devEl = document.getElementById('qc-device');
  const btn = document.getElementById('qc-activate');
  const send = (type, extra) => new Promise((res) => {
    try {
      chrome.runtime.sendMessage(Object.assign({ type }, extra || {}), (r) => {
        if (chrome.runtime.lastError) { res({ success: false, error: chrome.runtime.lastError.message }); return; }
        res(r || { success: false, error: '扩展后台无响应' });
      });
    } catch (e) { res({ success: false, error: String((e && e.message) || e) }); }
  });
  const show = (t, ok) => { msg.textContent = t; msg.className = 'qc-msg ' + (ok ? 'ok' : 'err'); };
  const ready = (d) => { document.body.classList.remove('qc-gated'); document.body.classList.add('qc-ready'); if (d && d.device_id && devEl) devEl.textContent = d.device_id; };
  const gateOn = (d) => { document.body.classList.add('qc-gated'); document.body.classList.remove('qc-ready'); if (d && d.device_id && devEl) devEl.textContent = d.device_id; };
  const st = await send('LICENSE_STATUS');
  if (st && st.success && st.data && st.data.is_active) ready(st.data); else gateOn(st && st.data);
  btn.addEventListener('click', async () => {
    const code = (codeEl.value || '').trim();
    if (!code) { show('请输入卡密', false); return; }
    btn.disabled = true;
    show('正在向授权服务器提交…', true);
    const r = await send('LICENSE_ACTIVATE', { code });
    btn.disabled = false;
    if (!r || !r.success) { show('激活失败：' + ((r && r.error) || '未知错误'), false); return; }
    show('激活成功，正在进入…', true);
    setTimeout(() => location.reload(), 600);
  });
  codeEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });
})();
