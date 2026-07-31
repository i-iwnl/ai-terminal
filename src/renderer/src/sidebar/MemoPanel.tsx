// メモパネル。「全体メモ」1枚と、履歴セッションに紐付く「セッションメモ」を扱う。
//
// 保存は明示ボタンではなく、入力停止から一定時間後の自動保存 ＋ blur 時の保存。
// ターミナルを触りながら書き殴る用途なので、保存操作を意識させないことを優先する。
// Main 側は本文が空になったらそのメモを削除するため、消す操作も「全部消す」で足りる。
//
// Issue #20 PR 9: セッションメモ一覧の行は `<li onClick>` で、キーボードでは
// 到達できなかった。#64 / PR #80（TaskList.tsx）の流儀に合わせ、`<li>` は
// 保ったまま中身を <button> にする。行にメモ以外のインタラクティブ要素が
// 無い（TaskList のような div/button の分岐が不要）ため、全行を常に <button> にする。

import { useCallback, useEffect, useRef, useState } from 'react';
import type { HistoryProvider, ListMemosResult, SetMemoRequest } from '@shared/ipc';
import { formatRelativeTime } from '../lib/format';

/** 開くべきセッションメモの指定（履歴一覧の「メモ」ボタンから渡ってくる）。 */
export interface MemoTarget {
  provider: HistoryProvider;
  stableId: string;
  /** 履歴一覧での表示名。メモ一覧にもこの名前で残す */
  title: string;
}

export interface MemoPanelProps {
  /** 履歴から開かれたセッション。未指定なら一覧から選ぶ */
  target: MemoTarget | null;
  onSelectTarget: (target: MemoTarget | null) => void;
  /**
   * 空状態から履歴タブへ飛ぶボタン用（Issue #20 I-3）。
   *
   * 「メモは履歴一覧の『メモ』ボタンから開く」という案内だけでは、履歴タブを
   * 一度も開いていない利用者にとって「その行がどこにあるか」が分からない循環参照になる。
   * ここにも履歴タブへの往路を用意する。
   */
  onGoToHistory: () => void;
}

/** 入力が止まってから保存するまでの待ち時間（ミリ秒）。 */
const AUTOSAVE_DELAY_MS = 800;

const EMPTY: ListMemosResult = {
  global: { scope: 'global', body: '', updatedAt: 0 },
  sessions: [],
};

/** メモ本文の冒頭を一覧用の1行に畳む。 */
function previewOf(body: string): string {
  const firstLine = body.split('\n').find((line) => line.trim().length > 0) ?? '';
  return firstLine.trim().slice(0, 60);
}

export default function MemoPanel({ target, onSelectTarget, onGoToHistory }: MemoPanelProps) {
  const [memos, setMemos] = useState<ListMemosResult>(EMPTY);
  const [globalDraft, setGlobalDraft] = useState('');
  const [sessionDraft, setSessionDraft] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  // 自動保存のタイマー。次の入力時と、フラッシュ・アンマウント時に必ず解除する。
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // タイマーが焼ける前の保存内容。アンマウント時とウィンドウ終了時に、
  // ここに残っているものを書き出す（デバウンス待ちの入力を捨てないため）。
  const pendingRef = useRef<SetMemoRequest | null>(null);

  const applyResult = useCallback((result: ListMemosResult) => {
    setMemos(result);
    setError(undefined);
  }, []);

  const reportError = useCallback((err: unknown) => {
    setError(err instanceof Error ? err.message : String(err));
  }, []);

  // 初回にメモ一覧を取得する。取得できなくても空表示で続行する。
  useEffect(() => {
    window.api.memo
      .list()
      .then((result) => {
        applyResult(result);
        setGlobalDraft(result.global.body);
      })
      .catch(reportError);
  }, [applyResult, reportError]);

  // 「どの対象を下書きに読み込み済みか」。保存のたびに memos が差し替わるが、
  // そのたびに下書きを取得結果で上書きすると入力中のカーソルが飛ぶ。
  // 対象が変わったときだけ読み込むための番人。
  const loadedTargetRef = useRef<string | null>(null);

  // 対象セッションが変わったら、そのセッションの本文を下書きに読み込む。
  // まだメモが無いセッション（履歴から新規に開いた場合）は空文字から始める。
  useEffect(() => {
    const key = target ? `${target.provider ?? ''}:${target.stableId}` : null;
    if (loadedTargetRef.current === key) return;
    loadedTargetRef.current = key;

    if (!target) {
      setSessionDraft('');
      return;
    }
    const found = memos.sessions.find(
      (m) => m.provider === target.provider && m.stableId === target.stableId,
    );
    setSessionDraft(found?.body ?? '');
  }, [target, memos]);

  const save = useCallback(
    (req: SetMemoRequest) => {
      window.api.memo.set(req).then(applyResult).catch(reportError);
    },
    [applyResult, reportError],
  );

  /** 入力のたびに呼ぶ。前のタイマーを解除して張り直す（デバウンス）。 */
  const scheduleSave = useCallback(
    (req: SetMemoRequest) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      pendingRef.current = req;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        pendingRef.current = null;
        save(req);
      }, AUTOSAVE_DELAY_MS);
    },
    [save],
  );

  /** blur 時など、待たずに保存したいときに呼ぶ。 */
  const saveNow = useCallback(
    (req: SetMemoRequest) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      pendingRef.current = null;
      save(req);
    },
    [save],
  );

  /**
   * 保留中の保存を、待たずに書き出す。
   *
   * 画面が消える直前に呼ばれるので、結果を state に戻さない（戻す先が無い）。
   * 失敗しても報告先が無いため握り潰す。
   */
  const flushPending = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const req = pendingRef.current;
    if (!req) return;
    pendingRef.current = null;
    window.api.memo.set(req).catch(() => {
      // ここで表示できる場所が既に無い。保存の取りこぼし自体はこれ以上防げない。
    });
  }, []);

  // アンマウント時に保留分を書き出す。
  // 以前は解除するだけだったため、blur を伴わずにパネルが消えると入力が失われた。
  useEffect(() => {
    return () => flushPending();
  }, [flushPending]);

  // ウィンドウを閉じる / アプリを終了する経路では React のアンマウントが走らない。
  // beforeunload の時点ではまだ IPC が生きているので、ここで書き出す
  // （Main 側は writeFileSync なので、届きさえすれば終了までに書き終わる）。
  useEffect(() => {
    window.addEventListener('beforeunload', flushPending);
    return () => window.removeEventListener('beforeunload', flushPending);
  }, [flushPending]);

  const globalRequest = (body: string): SetMemoRequest => ({ scope: 'global', body });

  const sessionRequest = (body: string): SetMemoRequest | null => {
    if (!target) return null;
    return {
      scope: 'session',
      provider: target.provider,
      stableId: target.stableId,
      title: target.title,
      body,
    };
  };

  return (
    <div className="memo-panel">
      {error && (
        <div className="panel-message panel-message--error">メモの保存に失敗しました: {error}</div>
      )}

      <section className="memo-panel__section">
        <h2 className="memo-panel__heading">全体メモ</h2>
        <textarea
          className="memo-panel__textarea"
          aria-label="全体メモ"
          placeholder="どのセッションにも属さない走り書き"
          value={globalDraft}
          onChange={(e) => {
            setGlobalDraft(e.target.value);
            scheduleSave(globalRequest(e.target.value));
          }}
          onBlur={(e) => saveNow(globalRequest(e.target.value))}
        />
      </section>

      <section className="memo-panel__section">
        <h2 className="memo-panel__heading">セッションのメモ</h2>

        {target ? (
          <div className="memo-panel__target">
            <div className="memo-panel__target-head">
              <span className="memo-panel__target-title" title={target.title}>
                {target.title}
              </span>
              <button
                type="button"
                className="memo-panel__close"
                aria-label="セッションメモを閉じる"
                onClick={() => {
                  const req = sessionRequest(sessionDraft);
                  if (req) saveNow(req);
                  onSelectTarget(null);
                }}
              >
                x
              </button>
            </div>
            <textarea
              className="memo-panel__textarea"
              aria-label="セッションメモ"
              placeholder="このセッションについてのメモ"
              autoFocus
              value={sessionDraft}
              onChange={(e) => {
                setSessionDraft(e.target.value);
                const req = sessionRequest(e.target.value);
                if (req) scheduleSave(req);
              }}
              onBlur={(e) => {
                const req = sessionRequest(e.target.value);
                if (req) saveNow(req);
              }}
            />
          </div>
        ) : (
          <div className="memo-panel__empty">
            <p className="memo-panel__hint">
              過去のセッションを開いて「メモ」を押すと、ここに残ります。
            </p>
            <button type="button" className="memo-panel__goto-history" onClick={onGoToHistory}>
              履歴を見る
            </button>
          </div>
        )}

        {memos.sessions.length === 0 ? (
          <p className="memo-panel__hint">セッションのメモはまだありません。</p>
        ) : (
          <ul className="memo-panel__list">
            {memos.sessions.map((memo) => {
              const isOpen =
                target !== null &&
                target.provider === memo.provider &&
                target.stableId === memo.stableId;
              const title = memo.title ?? `セッション ${(memo.stableId ?? '').slice(0, 8)}`;
              const preview = previewOf(memo.body);
              // 視覚順（タイトル -> 本文冒頭 -> プロバイダ -> 更新時刻）をそのまま
              // 読み上げ順にする。「開く」を明示するのは、タイトル文字列だけでは
              // 押すと何が起きるか伝わらないため（history-item__row と同じ理由）。
              const ariaLabel = [
                title,
                preview,
                memo.provider,
                formatRelativeTime(memo.updatedAt),
                '開く',
              ]
                .filter((part): part is string => part !== undefined && part !== '')
                .join('、');
              return (
                <li
                  key={`${memo.provider ?? ''}:${memo.stableId ?? ''}`}
                  className={`memo-item${isOpen ? ' is-open' : ''}`}
                >
                  <button
                    type="button"
                    className="memo-item__row"
                    aria-label={ariaLabel}
                    onClick={() => {
                      // provider / stableId は Main が保存キーから復元して必ず埋めるが、
                      // 型の上では optional なのでここで確定させる。
                      if (!memo.stableId || !memo.provider) return;
                      onSelectTarget({
                        provider: memo.provider,
                        stableId: memo.stableId,
                        title,
                      });
                    }}
                  >
                    <div className="memo-item__title">{title}</div>
                    <div className="memo-item__preview">{preview}</div>
                    <div className="memo-item__meta">
                      <span>{memo.provider}</span>
                      <span>{formatRelativeTime(memo.updatedAt)}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
