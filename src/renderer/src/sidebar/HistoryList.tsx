// セッション履歴 / resume 一覧（Phase 4）。
// parseError が付いているエントリも隠さず、sessionId と時刻だけで縮退表示する。
// Gemini 側は Main が縮退実装（空配列やエラー）を返す可能性があるため、
// 常に catch して壊れないようにする。
//
// cwd（作業ディレクトリ）は非同期に解決されるため、解決前は '' を渡して
// 無駄な失敗を起こさず、「取得中」であることが分かる表示にする。

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import type { HistoryProvider, SessionHistoryEntry } from '@shared/ipc';
import { formatRelativeTime, sessionDisplayTitle } from '../lib/format';
import { getSharedCwd, isSharedCwdResolved, resolveSharedCwd, subscribeSharedCwd } from '../lib/cwd';
import type { MemoTarget } from './MemoPanel';

export interface HistoryListProps {
  onResume: (entry: SessionHistoryEntry) => void;
  /** そのセッションのメモをメモタブで開く */
  onOpenMemo: (target: MemoTarget) => void;
}

export default function HistoryList({ onResume, onOpenMemo }: HistoryListProps) {
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

  // タイトルのインライン編集。編集キーは stableId（gemini は内部 UUID が取れず
  // undefined のことがあり、その場合は編集不可 = 編集ボタンを出さない）。
  // 編集中でなければ editingStableId は null。
  const [editingStableId, setEditingStableIdState] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  // editingStableId の state 更新は非同期なので、Enter -> blur のように同一ティック内で
  // 二重確定を防ぎたい箇所は、同期的に更新できるこの ref を見て判定する
  // （TabBar.tsx の editingTabIdRef と同じパターン）。
  const editingStableIdRef = useRef<string | null>(null);

  const setEditing = (id: string | null): void => {
    editingStableIdRef.current = id;
    setEditingStableIdState(id);
  };

  const startEditing = (entry: SessionHistoryEntry, displayTitle: string): void => {
    if (entry.stableId === undefined) return;
    setEditing(entry.stableId);
    setDraft(displayTitle);
  };

  const cancelEditing = (): void => {
    setEditing(null);
  };

  const commitEditing = (entry: SessionHistoryEntry, originalTitle: string): void => {
    // Enter で確定済み（ref が既に変わっている）なら、続く blur では何もしない。
    if (entry.stableId === undefined || editingStableIdRef.current !== entry.stableId) return;
    const stableId = entry.stableId;
    const trimmed = draft.trim();
    setEditing(null);
    // 空、または表示中のタイトルと同じならキャンセル扱い（保存しない）。
    if (trimmed === '' || trimmed === originalTitle) return;
    window.api.history
      .setTitle({ provider: entry.provider, stableId, title: trimmed })
      .then(() => load())
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  };

  // タイトル表示部分。parseError の縮退表示・通常表示のどちらからも呼び、
  // 編集ボタン / インライン input への切り替えを共通化する。
  const renderTitle = (entry: SessionHistoryEntry, displayTitle: string) => {
    if (entry.stableId !== undefined && editingStableId === entry.stableId) {
      return (
        <input
          className="history-item__title-input"
          aria-label="履歴タイトルを編集"
          value={draft}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e: MouseEvent<HTMLInputElement>) => e.stopPropagation()}
          onDoubleClick={(e: MouseEvent<HTMLInputElement>) => e.stopPropagation()}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') {
              // IME の変換確定の Enter では編集を確定しない。
              if (e.nativeEvent.isComposing) return;
              e.preventDefault();
              // blur が発火して onBlur の二重確定にならないよう、
              // 確定を先に済ませてから編集状態を抜ける。
              commitEditing(entry, displayTitle);
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancelEditing();
              e.currentTarget.blur();
            }
          }}
          onBlur={() => commitEditing(entry, displayTitle)}
        />
      );
    }
    // stableId を局所の const に写しておく。プロパティのままだと、
    // コールバックの中では「undefined ではない」という絞り込みが維持されない。
    const stableId = entry.stableId;
    return (
      <div className="history-item__title-row">
        <div className="history-item__title">{displayTitle}</div>
        {stableId !== undefined && (
          <>
            <button
              type="button"
              className="history-item__action"
              aria-label="メモを開く"
              onClick={(e: MouseEvent<HTMLButtonElement>) => {
                // メモを開くだけで resume は走らせない。
                e.stopPropagation();
                onOpenMemo({
                  provider: entry.provider,
                  stableId,
                  title: displayTitle,
                });
              }}
            >
              メモ
            </button>
            <button
              type="button"
              className="history-item__action"
              aria-label="タイトルを編集"
              onClick={(e: MouseEvent<HTMLButtonElement>) => {
                e.stopPropagation();
                startEditing(entry, displayTitle);
              }}
            >
              編集
            </button>
          </>
        )}
      </div>
    );
  };

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
          entries.map((entry) => {
            // 編集中の行はクリックしても resume に波及させない。
            // input 外の余白クリックは blur -> commitEditing が先に走るが、
            // その click ハンドラの実行時点ではまだ再レンダー前の
            // editingStableId（編集中の値）を参照するため、このクリックでは resume しない。
            const isEditingThisRow = entry.stableId !== undefined && editingStableId === entry.stableId;
            return (
              <li
                key={entry.sessionId}
                className="history-item"
                onClick={() => {
                  if (isEditingThisRow) return;
                  onResume(entry);
                }}
              >
                {entry.parseError ? (
                  <div>
                    {/* 縮退表示でも、上書きタイトル（Main が title に重ねて返す）があればそちらを出す。 */}
                    {renderTitle(entry, sessionDisplayTitle(entry))}
                    <div className="history-item__meta">
                      <span>{formatRelativeTime(entry.updatedAt)}</span>
                    </div>
                    <div className="history-item__error">解析エラー: {entry.parseError}</div>
                  </div>
                ) : (
                  <div>
                    {renderTitle(entry, sessionDisplayTitle(entry))}
                    <div className="history-item__meta">
                      <span>{formatRelativeTime(entry.updatedAt)}</span>
                      {entry.gitBranch && <span>{entry.gitBranch}</span>}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
      </ul>
    </div>
  );
}
