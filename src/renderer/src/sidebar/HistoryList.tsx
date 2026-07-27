// セッション履歴 / resume 一覧（Phase 4）。
// parseError が付いているエントリも隠さず、sessionId と時刻だけで縮退表示する。
// Gemini 側は Main が縮退実装（空配列やエラー）を返す可能性があるため、
// 常に catch して壊れないようにする。
//
// cwd（作業ディレクトリ）は非同期に解決されるため、解決前は '' を渡して
// 無駄な失敗を起こさず、「取得中」であることが分かる表示にする。

import { useCallback, useEffect, useState } from 'react';
import type { HistoryProvider, SessionHistoryEntry } from '@shared/ipc';
import { formatRelativeTime, shortId } from '../lib/format';
import { getSharedCwd, isSharedCwdResolved, resolveSharedCwd, subscribeSharedCwd } from '../lib/cwd';

export interface HistoryListProps {
  onResume: (entry: SessionHistoryEntry) => void;
}

export default function HistoryList({ onResume }: HistoryListProps) {
  const [provider, setProvider] = useState<HistoryProvider>('claude');
  const [entries, setEntries] = useState<SessionHistoryEntry[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [cwdReady, setCwdReady] = useState(isSharedCwdResolved());

  // cwd がまだ解決されていない場合、他の場所（App 側の起動処理）で解決中であっても
  // ここでも解決を試みておく（resolveSharedCwd は idempotent なので二重に呼んでも安全）。
  useEffect(() => {
    if (isSharedCwdResolved()) return;
    void resolveSharedCwd();
    const unsubscribe = subscribeSharedCwd(() => setCwdReady(true));
    return unsubscribe;
  }, []);

  const load = useCallback(() => {
    if (!isSharedCwdResolved()) return;
    setLoading(true);
    window.api.history
      .list({ provider, cwd: getSharedCwd() ?? '' })
      .then((res) => {
        setEntries(res.entries);
        setError(res.error);
      })
      .catch((err: unknown) => {
        setEntries([]);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, [provider]);

  useEffect(() => {
    if (!cwdReady) return;
    load();
  }, [cwdReady, load]);

  return (
    <div className="history-list">
      <div className="history-list__toolbar">
        <div className="history-list__providers">
          <button
            className={provider === 'claude' ? 'is-active' : ''}
            onClick={() => setProvider('claude')}
          >
            Claude
          </button>
          <button
            className={provider === 'gemini' ? 'is-active' : ''}
            onClick={() => setProvider('gemini')}
          >
            Gemini
          </button>
        </div>
        <button
          className="history-list__reload"
          onClick={load}
          disabled={loading || !cwdReady}
          title="再読み込み"
        >
          {loading ? '...' : '更新'}
        </button>
      </div>

      {!cwdReady && <div className="panel-message">作業ディレクトリを取得中...</div>}
      {cwdReady && error && (
        <div className="panel-message panel-message--error">履歴の取得に失敗しました: {error}</div>
      )}
      {cwdReady && !error && !loading && entries.length === 0 && (
        <div className="panel-message">履歴はありません</div>
      )}

      <ul>
        {cwdReady &&
          entries.map((entry) => (
            <li key={entry.sessionId} className="history-item" onClick={() => onResume(entry)}>
              {entry.parseError ? (
                <div>
                  <div className="history-item__title">セッション {shortId(entry.sessionId)}</div>
                  <div className="history-item__meta">
                    <span>{formatRelativeTime(entry.updatedAt)}</span>
                  </div>
                  <div className="history-item__error">解析エラー: {entry.parseError}</div>
                </div>
              ) : (
                <div>
                  <div className="history-item__title">
                    {entry.title ?? entry.firstPrompt ?? `セッション ${shortId(entry.sessionId)}`}
                  </div>
                  <div className="history-item__meta">
                    <span>{formatRelativeTime(entry.updatedAt)}</span>
                    {entry.gitBranch && <span>{entry.gitBranch}</span>}
                  </div>
                </div>
              )}
            </li>
          ))}
      </ul>
    </div>
  );
}
