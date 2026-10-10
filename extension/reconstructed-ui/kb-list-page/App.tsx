import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { browser } from '../../lib/env';
import type { CollectResult, KnowledgeBase, KnowledgeItem } from '../../lib/ima/types';
import { clearAllCaches, formatSize, readCache, relativeTime, writeCache, type KbCache } from './cache';
import { runExport, type ExportItemResult } from '../../lib/export';

/**
 * 逆向重建：知识库列表页（kb-list-page.html）—— 主工作台。
 * 功能面（对照产物文案）：搜索/排序、缓存状态、增量更新、文件夹选择、批量导出、进度与结果。
 */

type SortKey = 'name' | 'update_time' | 'file_count' | 'size';
type SortDir = 'asc' | 'desc';
type FilterKey = 'all' | 'personal' | 'created' | 'joined';
type Phase = 'idle' | 'collecting' | 'exporting';

export default function App() {
  const [list, setList] = useState<KnowledgeBase[]>([]);
  const [caches, setCaches] = useState<Record<string, KbCache | null>>({});
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [sortKey, setSortKey] = useState<SortKey>('update_time');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState({ collected: 0, total: 0, done: 0 });
  const [log, setLog] = useState<string[]>([]);
  const [current, setCurrent] = useState<KnowledgeBase | null>(null);
  const [format, setFormat] = useState<'html' | 'md'>('html');
  const [folderPicker, setFolderPicker] = useState<{ items: KnowledgeItem[]; path: string; cursor: string; isEnd: boolean } | null>(null);
  const collectedRef = useRef<CollectResult | null>(null);

  const pushLog = (line: string) => setLog((prev) => [...prev.slice(-200), line]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const res: any = await browser.runtime.sendMessage({ type: 'GET_KNOWLEDGE_BASE_LIST' });
    if (!res?.success) { setError(res?.error || '获取知识库列表失败'); setLoading(false); return; }
    setList(res.data as KnowledgeBase[]);
    const next: Record<string, KbCache | null> = {};
    for (const kb of res.data as KnowledgeBase[]) next[kb.id] = await readCache(kb.id);
    setCaches(next);
    setError('');
    setLoading(false);
    pushLog('刷新列表完成，共 ' + (res.data as KnowledgeBase[]).length + ' 个知识库');
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // 采集进度（storage.session）
  useEffect(() => {
    const timer = setInterval(async () => {
      const stored = await browser.storage.session.get('collect_progress');
      const p = stored.collect_progress as { collected: number; total: number } | undefined;
      if (p) setProgress((prev) => ({ ...prev, collected: p.collected, total: p.total || prev.total }));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = list.filter((kb) => {
      if (filter === 'personal' && kb.type !== 'personal') return false;
      if (filter === 'created' && kb.type !== 'created') return false;
      if (filter === 'joined' && kb.type !== 'joined') return false;
      if (!q) return true;
      return [kb.name, kb.creator_name, kb.description].some((v) => (v || '').toLowerCase().includes(q));
    });
    const dir = sortDir === 'asc' ? 1 : -1;
    return filtered.sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name) * dir;
      if (sortKey === 'file_count') return (a.file_count - b.file_count) * dir;
      if (sortKey === 'size') return (Number(a.size) - Number(b.size)) * dir;
      return (Number(a.update_time) - Number(b.update_time)) * dir;
    });
  }, [list, query, filter, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(key === 'name' ? 'asc' : 'desc'); }
  };

  const collect = async (kb: KnowledgeBase, mode: 'full' | 'incremental', folderScope?: { folderId: string; folderPath?: string }) => {
    setPhase('collecting');
    setProgress({ collected: 0, total: kb.file_count, done: 0 });
    const cached = caches[kb.id];
    const payload: Record<string, unknown> = { type: 'COLLECT_KNOWLEDGE_VIA_BG', knowledgeBaseId: kb.id, fileCount: kb.file_count, folderScope };
    if (mode === 'incremental' && cached) {
      payload.incremental = { lastCollectedAt: cached.collectedAt, cachedDocuments: cached.documents, cachedFolders: cached.folders };
    }
    const res: any = await browser.runtime.sendMessage(payload);
    setPhase('idle');
    if (!res?.success) { pushLog('采集失败：' + (res?.error || '未知错误')); return null; }
    const result = res.data as CollectResult;
    collectedRef.current = result;
    await writeCache(kb.id, result);
    setCaches((prev) => ({ ...prev, [kb.id]: { knowledgeBaseId: kb.id, collectedAt: Date.now(), documents: result.documents, folders: result.folders, kbUpdateTime: result.kbUpdateTime } }));
    const stats = result.incrementalStats;
    pushLog(
      stats
        ? stats.noChange
          ? '知识库自上次收集后没有任何更新（' + result.totalDocuments + ' 个文档）'
          : '增量更新完成：新增 ' + stats.newCount + '，更新 ' + stats.updatedCount + '，跳过未变更文件夹 ' + stats.skippedFolders
        : '收集完成：' + result.totalDocuments + ' 个文档，' + result.totalFolders + ' 个文件夹',
    );
    return result;
  };

  const doExport = async (kb: KnowledgeBase, folderScope?: { folderId: string; folderPath?: string }) => {
    const result = collectedRef.current?.documents ? collectedRef.current : await collect(kb, caches[kb.id] ? 'incremental' : 'full', folderScope);
    if (!result?.documents?.length) { pushLog('没有可导出的文档'); return; }
    setPhase('exporting');
    setProgress({ collected: result.totalDocuments, total: result.totalDocuments, done: 0 });
    const name = kb.name || 'ima-export';
    await runExport(result.documents, name, format, (done, total, latest: ExportItemResult) => {
      setProgress((prev) => ({ ...prev, done, total }));
      pushLog((latest.ok ? '✓ ' : '✗ ') + latest.title + (latest.error ? '（' + latest.error + '）' : ''));
    });
    setPhase('idle');
    pushLog('导出结束：' + kb.name);
  };

  const openFolderPicker = async (kb: KnowledgeBase) => {
    const res: any = await browser.runtime.sendMessage({ type: 'GET_KNOWLEDGE_FOLDER_PAGE', knowledgeBaseId: kb.id, parentFolderId: kb.id, parentPath: '', cursor: '' });
    if (!res?.success) { pushLog(res?.error || '获取文件夹失败'); return; }
    setCurrent(kb);
    setFolderPicker({ items: res.data.folders, path: '根目录', cursor: res.data.nextCursor, isEnd: res.data.isEnd });
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1>导出助手</h1>
        <div className="spacer" />
        <span className="badge">直连模式 · 不限次数</span>
        <select value={format} onChange={(e) => setFormat(e.target.value as 'html' | 'md')}>
          <option value="html">笔记导出为 HTML</option>
          <option value="md">笔记导出为 Markdown</option>
        </select>
        <button onClick={refresh}>刷新列表</button>
        <button onClick={async () => { if (confirm('清空所有知识库缓存？将删除本地缓存的知识库结构数据。下次打开时需要重新收集（下载记录不受影响）。')) { await clearAllCaches(); setCaches({}); pushLog('已清空全部缓存'); } }}>清空缓存</button>
      </header>

      {error ? <p className="error">{error}</p> : null}

      <section className="toolbar">
        <input placeholder="搜索知识库名称、创建者、描述" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="filters">
          {(['all', 'personal', 'created', 'joined'] as FilterKey[]).map((f) => (
            <button key={f} className={filter === f ? 'chip active' : 'chip'} onClick={() => setFilter(f)}>
              {f === 'all' ? '全部' : f === 'personal' ? '个人' : f === 'created' ? '创建' : '加入'}
            </button>
          ))}
        </div>
        <div className="sorts">
          {([['name', '名称'], ['update_time', '最近更新'], ['file_count', '文件数'], ['size', '大小']] as Array<[SortKey, string]>).map(([k, label]) => (
            <button key={k} className={sortKey === k ? 'chip active' : 'chip'} title="点选切换字段，再次点选同一字段切换升/降序" onClick={() => toggleSort(k)}>
              按{label}
            </button>
          ))}
        </div>
      </section>

      {phase !== 'idle' ? (
        <div className="progress">
          <span>{phase === 'collecting' ? '正在收集知识库' : '正在导出'}</span>
          <span>{phase === 'collecting' ? '已收集 ' + progress.collected + ' 个' : progress.done + ' / ' + progress.total}</span>
        </div>
      ) : null}

      {loading ? <p className="muted">加载中…</p> : (
        <ul className="kb-list">
          {visible.map((kb) => {
            const cache = caches[kb.id];
            return (
              <li key={kb.id} className="kb-card">
                <div className="kb-main">
                  <h3>{kb.name}</h3>
                  <p className="muted">{kb.description || '暂无描述'}</p>
                  <p className="meta">
                    <span>{kb.type === 'personal' ? '个人' : kb.type}</span>
                    <span>{kb.access_status === 1 ? '公开' : kb.access_status === 2 ? '可读' : '私有'}</span>
                    <span>{kb.creator_name}</span>
                    <span>{formatSize(kb.size)}</span>
                    <span>{kb.file_count} 个文件</span>
                    <span>最近更新 {relativeTime(Number(kb.update_time) * 1000)}</span>
                  </p>
                  <p className="meta">
                    {cache ? <span className="ok">已缓存 · 缓存于 {relativeTime(cache.collectedAt)}（{cache.documents.length} 文档 / {cache.folders.length} 文件夹）</span> : <span className="muted">未收集</span>}
                  </p>
                </div>
                <div className="kb-actions">
                  {cache ? (
                    <>
                      <button onClick={() => doExport(kb)}>直接打开</button>
                      <button onClick={() => collect(kb, 'incremental')}>增量更新</button>
                      <button onClick={() => collect(kb, 'full')}>重新收集…</button>
                    </>
                  ) : (
                    <button className="primary" onClick={() => collect(kb, 'full')}>采集此文件夹</button>
                  )}
                  <button onClick={() => openFolderPicker(kb)}>按文件夹采集</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {folderPicker ? (
        <div className="modal">
          <div className="modal-body">
            <h2>选择采集文件夹</h2>
            <p className="muted">当前：{folderPicker.path}</p>
            {folderPicker.items.length === 0 ? <p className="muted">当前批次没有子文件夹</p> : (
              <ul>
                {folderPicker.items.map((f) => (
                  <li key={f.media_id}>
                    <span>{f.title}</span>
                    <button onClick={async () => {
                      if (!current) return;
                      const res: any = await browser.runtime.sendMessage({ type: 'GET_KNOWLEDGE_FOLDER_PAGE', knowledgeBaseId: current.id, parentFolderId: f.media_id, parentPath: folderPicker.path === '根目录' ? f.title : folderPicker.path + '/' + f.title, cursor: '' });
                      if (!res?.success) { pushLog(res?.error || '获取文件夹失败'); return; }
                      setFolderPicker({ items: res.data.folders, path: folderPicker.path === '根目录' ? f.title : folderPicker.path + '/' + f.title, cursor: res.data.nextCursor, isEnd: res.data.isEnd });
                    }}>打开</button>
                    <button onClick={() => { if (current) { setFolderPicker(null); void collect(current, 'full', { folderId: f.media_id, folderPath: f.title }); } }}>采集此文件夹</button>
                  </li>
                ))}
              </ul>
            )}
            <div className="modal-actions">
              {!folderPicker.isEnd ? (
                <button onClick={async () => {
                  if (!current) return;
                  const res: any = await browser.runtime.sendMessage({ type: 'GET_KNOWLEDGE_FOLDER_PAGE', knowledgeBaseId: current.id, parentFolderId: current.id, parentPath: '', cursor: folderPicker.cursor });
                  if (!res?.success) { pushLog(res?.error || '获取更多文件夹失败'); return; }
                  setFolderPicker({ items: [...folderPicker.items, ...res.data.folders], path: folderPicker.path, cursor: res.data.nextCursor, isEnd: res.data.isEnd });
                }}>加载更多</button>
              ) : null}
              <button onClick={() => setFolderPicker(null)}>取消</button>
            </div>
          </div>
        </div>
      ) : null}

      <aside className="log">
        <h2>运行日志</h2>
        <pre>{log.join('\n')}</pre>
      </aside>
    </div>
  );
}
