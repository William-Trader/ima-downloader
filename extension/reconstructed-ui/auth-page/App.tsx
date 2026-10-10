import { useCallback, useEffect, useState } from 'react';
import { browser } from '../../lib/env';
import { DISCLAIMER_AGREE_LABEL, DISCLAIMER_CONFIRM_LABEL, DISCLAIMER_INTRO, DISCLAIMER_SECTIONS, DISCLAIMER_TITLE } from './Disclaimer';

/**
 * 逆向重建：登录/入口页（auth-page.html）。
 * 流程：免责声明 -> 检查 IMA 登录态（借用专用 IMA 页面）-> 打开知识库列表页。
 * 本机这一份为「直连模式」：不出现兑换码，会员权益固定为不限次数。
 */

type Phase = 'disclaimer' | 'ready' | 'checking' | 'need-login';

export default function App() {
  const [phase, setPhase] = useState<Phase>('disclaimer');
  const [agreed, setAgreed] = useState(false);
  const [message, setMessage] = useState('');
  const [imaTabId, setImaTabId] = useState<number | null>(null);

  const send = useCallback(async (type: string, extra: Record<string, unknown> = {}) => {
    const res: any = await browser.runtime.sendMessage({ type, ...extra });
    return res;
  }, []);

  useEffect(() => { void send('START_EXPORT'); }, [send]);

  const enterKnowledgeBase = async () => {
    setPhase('checking');
    setMessage('正在检查 IMA 登录');
    const res = await send('START_EXPORT');
    if (!res?.success) {
      if (res?.needImaLogin) {
        setPhase('need-login');
        setImaTabId(res.imaTabId ?? null);
        if (imaTabId != null || res.imaTabId != null) await send('SET_ACTIVE_IMA_TAB', { tabId: res.imaTabId });
        setMessage('已打开 IMA 登录页。完成登录后回到此页，再点一次按钮。');
        return;
      }
      setPhase('ready');
      setMessage(res?.error || '导出服务无响应，请重试。');
      return;
    }
    await openKnowledgeBaseList();
  };

  const openKnowledgeBaseList = async () => {
    setMessage('准备打开知识库');
    const res: any = await send('GET_KNOWLEDGE_BASE_LIST');
    if (!res?.success) { setPhase('ready'); setMessage(res?.error || '登录态检查失败，请重试。'); return; }
    await browser.tabs.create({ url: browser.runtime.getURL('/kb-list-page.html') });
    window.close();
  };

  if (phase === 'disclaimer') {
    return (
      <main className="page disclaimer">
        <h1>{DISCLAIMER_TITLE}</h1>
        <p className="intro">{DISCLAIMER_INTRO}</p>
        {DISCLAIMER_SECTIONS.map((section) => (
          <section key={section.heading}>
            <h2>{section.heading}</h2>
            {section.body.map((line, i) => <p key={i}>{line}</p>)}
          </section>
        ))}
        <label className="agree">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>{DISCLAIMER_AGREE_LABEL}</span>
        </label>
        <button className="primary" disabled={!agreed} onClick={() => setPhase('ready')}>{DISCLAIMER_CONFIRM_LABEL}</button>
      </main>
    );
  }

  return (
    <main className="page entry">
      <header className="hero">
        <h1>导出助手</h1>
        <span className="badge">直连模式</span>
      </header>
      <p className="tip">点击按钮后会自动检查 IMA 登录态，通过后进入知识库列表。</p>
      <div className="card">
        <div className="row"><span>当前账号</span><b>已登录</b></div>
        <div className="row"><span>会员权益</span><b>不限次数</b></div>
        <div className="row"><span>剩余次数</span><b>不限次数</b></div>
        <div className="row"><span>到期</span><b>永久</b></div>
      </div>
      <button className="primary" disabled={phase === 'checking'} onClick={enterKnowledgeBase}>
        {phase === 'need-login' ? '我已登录 IMA，继续' : '进入知识库导出'}
      </button>
      {message ? <p className="message">{message}</p> : null}
      <footer className="links">
        <button className="link" onClick={() => browser.tabs.create({ url: browser.runtime.getURL('/assets/recharge.html') })}>充值说明</button>
        <button className="link" onClick={() => send('CHECK_QUOTA')}>刷新权益</button>
      </footer>
    </main>
  );
}
