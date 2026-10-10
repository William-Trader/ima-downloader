/*!
 * public/assets/recharge.js — ima-downloader 关键下载/授权逻辑
 * © 2026 William-Trader (https://github.com/William-Trader/ima-downloader)
 * WM: IMADL-WM-8003CB86
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * 依据 PolyForm Noncommercial 1.0.0：仅限非商业用途，禁止任何商业化使用。
 * 本文件含防拷贝水印标记，请勿删除；移除即视为违反许可证。
 */
/* 授权激活页 —— 经 background 消息桥访问清尘 qc-license 服务器（真实卡密校验，无本地伪成功）。 */
const sendMessage = (type, extra) =>
  new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(Object.assign({ type }, extra || {}), (res) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message || '扩展后台无响应，请重新打开本页' });
          return;
        }
        resolve(res || { success: false, error: '扩展后台无响应，请重新打开本页' });
      });
    } catch (err) {
      resolve({ success: false, error: String((err && err.message) || err) });
    }
  });

const byId = (id) => document.getElementById(id);
const resultBox = byId('result');

function show(text, ok) {
  resultBox.textContent = text;
  resultBox.className = 'result ' + (ok ? 'ok' : 'err');
}

function fmtTime(v) {
  if (!v) return '—';
  const s = String(v);
  if (/^[0-9]{9,}$/.test(s)) {
    const d = new Date(Number(s) * 1000);
    return isNaN(d.getTime()) ? s : d.toLocaleString('zh-CN', { hour12: false });
  }
  return s.replace('T', ' ').slice(0, 19);
}

function fmtRemaining(n) {
  if (n === -1 || n === 9999 || n === null || n === undefined) return '不限次数';
  return n + ' 次';
}

function render(info) {
  byId('f-active').textContent = info && info.is_active ? '已激活' : '未激活 / 已失效';
  byId('f-plan').textContent = (info && info.membership_type && info.membership_type !== 'none') ? info.membership_type : '—';
  byId('f-expires').textContent = info ? fmtTime(info.membership_expires_at) : '—';
  byId('f-remaining').textContent = info ? fmtRemaining(info.total_quota_remaining) : '—';
  byId('f-device').textContent = (info && info.device_id) || '—';
}

async function refresh(silent) {
  const res = await sendMessage('LICENSE_STATUS');
  if (!res || !res.success) {
    if (!silent) show('状态查询失败：' + ((res && res.error) || '未知错误'), false);
    render(null);
    return res;
  }
  render(res.data);
  if (!silent) show(res.data && res.data.is_active ? '授权有效，可正常导出。' : '尚未激活：请在上方输入卡密后点「激活」。', true);
  return res;
}

async function activate() {
  const code = (byId('code').value || '').trim();
  if (!code) { show('请先输入卡密', false); return; }
  byId('activate').disabled = true;
  show('正在向清尘授权服务器提交激活请求…', true);
  const res = await sendMessage('LICENSE_ACTIVATE', { code });
  byId('activate').disabled = false;
  if (!res || !res.success) {
    show('激活失败：' + ((res && res.error) || '未知错误'), false);
    return;
  }
  const d = res.data || {};
  show('✅ 激活成功' + String.fromCharCode(10) + '套餐：' + (d.plan || '—') + String.fromCharCode(10) + '到期：' + (d.expires_at ? fmtTime(d.expires_at) : '永久') + String.fromCharCode(10) + '剩余次数：' + fmtRemaining(d.remaining), true);
  byId('code').value = '';
  await refresh(true);
}

async function deactivate() {
  byId('deactivate').disabled = true;
  const res = await sendMessage('LICENSE_DEACTIVATE');
  byId('deactivate').disabled = false;
  if (!res || !res.success) { show('解绑失败：' + ((res && res.error) || '未知错误'), false); return; }
  show('已解绑本机授权，卡密可换绑到其它设备。', true);
  await refresh(true);
}

byId('activate').addEventListener('click', activate);
byId('refresh').addEventListener('click', () => refresh(false));
byId('deactivate').addEventListener('click', deactivate);
byId('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') activate(); });
void refresh(true);
