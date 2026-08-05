// セッション履歴 / resume 一覧（Phase 4）。
// parseError が付いているエントリも隠さず、sessionId と時刻だけで縮退表示する。
// Gemini 側は Main が縮退実装（空配列やエラー）を返す可能性があるため、
// 常に catch して壊れないようにする。
//
// cwd（作業ディレクトリ）は非同期に解決されるため、解決前は '' を渡して
// 無駄な失敗を起こさず、「取得中」であることが分かる表示にする。
//
// Issue #20 PR 9: 行は `<li onClick>` で resume していたが、キーボードでは
// 到達できなかった（tabindex も role も無い）。#64 / PR #80（TaskList.tsx）の
// 流儀に合わせ、`<li>` は保ったまま resume する部分だけを内側の <button> にする。
// 「メモ」「編集」は資料上ずっと押せるボタンなので、TaskList のような
// 「押せない行は非対話のまま」という分岐は無い（全行が resume 可能）。
//
// Issue #20 PR 12（I-3）: 0件のときの文言に実パスと次の行動を足す。「すべての
// フォルダを見る」は claude のみ対応（reader.ts の listAllClaudeHistory）。gemini は
// `--list-sessions` の実行 cwd 自体がスコープを決めており、横断すべきディレクトリを
// 列挙する手段が無いため、provider が gemini のときはボタン自体を出さない
// （動かないボタンを画面に置かない）。解析エラーは赤字2行から灰色1行へ、
// 詳細はツールチップへ移した（打つ手が無い情報を「要対応」の色で出さない）。
//
// Issue #20 PR 13-a': パネルの見出しを `履歴`（タブと同じ語の繰り返し）から
// スコープを表す語（`このフォルダ` / `すべてのフォルダ`）に差し替える。
// 行は増やさない（既存の <h2> のテキストだけを入れ替える）。要素そのものは
// 残す（廃すと履歴パネルの見出しが0個になり、VoiceOver の rotor から消える）。
//
// 同じ周で検討して**取り下げた**「すべてのフォルダのとき各行の meta に
// basename(entry.cwd) を出す」案は、Issue #119 の周2・周3 で入れた。
// 取り下げの理由だった2つが両方とも解消したため:
//   - `.history-item__row` の実効幅 139px -> **235px**（周2 で
//     `.history-item__actions` をフローから外した）
//   - meta に切り詰め規則が無く単語の途中で折り返す -> 周2 で
//     `min-width: 0` + `text-overflow: ellipsis` を入れた（相対時刻だけ
//     `flex-shrink: 0` なので、溢れたときに削られるのはフォルダ名とブランチ名）
//
// ただしこの行には resume 用の <button> の他に「メモ」「編集」という
// **別の**インタラクティブ要素がある。<button> の中に <button> は入れ子にできない
// （HTML の内容モデル上、<button> はインタラクティブコンテンツの子孫を許さない）ため、
// resume 用ボタンは行の中身のうちタイトル・メタ・エラー表示だけを包み、
// 「メモ」「編集」は兄弟として外に出す。編集中（input 表示中）はどちらも
// レンダリングしない（元の実装と同じ）。

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import type { HistoryProvider, SessionHistoryEntry } from '@shared/ipc';
import { basename, formatRelativeTime, sessionDisplayTitle } from '../lib/format';
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
  // Issue #20 I-3「すべてのフォルダを見る」。既定は現在のフォルダに絞り込む false。
  // gemini は cwd 単位の横断に対応していない（reader.ts 参照）ため、gemini では常に false 扱いにする。
  const [allFolders, setAllFolders] = useState(false);

  // 「いま絞り込みを外して見ているか」の唯一の判定。見出しとスコープ注記の
  // 2箇所で食い違わせないため、ここに集約する。
  // なお下の load はこれを使わない。load の依存配列をこの1値にすると、
  // provider を claude -> gemini に切り替えても（どちらも false のままなので）
  // load が再生成されず、gemini の一覧を読み直さなくなるため。
  const showingAllFolders = provider === 'claude' && allFolders;

  const load = useCallback(() => {
    if (!isSharedCwdResolved()) return;
    setLoading(true);
    window.api.history
      .list({
        provider,
        cwd: getSharedCwd() ?? '',
        allFolders: provider === 'claude' && allFolders,
      })
      .then((res) => {
        setEntries(res.entries);
        setError(res.error);
      })
      .catch((err: unknown) => {
        setEntries([]);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, [provider, allFolders]);

  // 購読コールバックから常に最新の load を呼べるようにする ref。
  // load は provider に依存する useCallback なので、購読の張り直し無しに
  // 最新版を呼びたい（後述）ときはこの ref 経由で参照する。
  const loadRef = useRef(load);
  loadRef.current = load;

  // cwd（アクティブなタブの作業ディレクトリ）が未解決なら他の場所（App 側の起動処理）で
  // 解決中であってもここでも解決を試みる（resolveSharedCwd は idempotent なので二重に呼んでも安全）。
  // 購読は cwd が変化するたび（cd への追従・タブ切り替え）に load を呼び直すために、
  // 初回解決後もそのまま張り続ける。購読自体はマウント時の1回だけ張り、
  // provider の切り替えで load が再生成されても購読を張り直さない
  // （張り直すと購読漏れ・二重購読のループの温床になるため、loadRef 経由で最新版を呼ぶ）。
  useEffect(() => {
    if (!isSharedCwdResolved()) {
      void resolveSharedCwd();
    }
    const unsubscribe = subscribeSharedCwd(() => {
      setCwdReady(true);
      loadRef.current();
    });
    return unsubscribe;
  }, []);

  // provider の切り替え（load の再生成）で読み直す。cwd がまだ未解決なら load 内部の
  // ガードで何もしない（解決した時点で上の購読が拾って読み直す）。
  useEffect(() => {
    load();
  }, [load]);

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

  /**
   * メタ情報（更新時刻・git ブランチ・解析エラー）。編集中・非編集中どちらでも同じものを出す。
   *
   * Issue #20 I-3: 解析エラーは「打つ手が無い情報」（JSONL の内部フォーマットが
   * バージョン間で変わりうることは公式に明記されており、利用者側に対処法が無い）
   * なので、赤字2行の「要対応」色ではなく灰色1行に落とす。resume 自体はできることを
   * 明示し、生のエラー文言（parseError）は詳細としてツールチップ（title）に残す。
   */
  const renderMeta = (entry: SessionHistoryEntry) => (
    <>
      <div className="history-item__meta">
        <span>{formatRelativeTime(entry.updatedAt)}</span>
        {/* Issue #20 I-2 / #119 周3: フォルダを横断しているときだけ、どのフォルダの
            セッションかを出す。絞り込み中は全行が同じ値になるので出さない
            （情報量ゼロの列を1つ増やすだけになる）。 */}
        {showingAllFolders && entry.cwd !== undefined && <span>{basename(entry.cwd)}</span>}
        {entry.gitBranch && <span>{entry.gitBranch}</span>}
      </div>
      {entry.parseError && (
        <div className="history-item__error" title={`解析エラーの詳細: ${entry.parseError}`}>
          内容を読めませんでした（再開はできます）
        </div>
      )}
    </>
  );

  const renderEntry = (entry: SessionHistoryEntry) => {
    const displayTitle = sessionDisplayTitle(entry);
    const stableId = entry.stableId;
    const isEditingThisRow = stableId !== undefined && editingStableId === stableId;

    if (isEditingThisRow) {
      return (
        <div>
          <input
            className="history-item__title-input"
            aria-label="履歴タイトルを編集"
            value={draft}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setDraft(e.target.value)}
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
          {renderMeta(entry)}
        </div>
      );
    }

    // 読み上げの文には「再開する」という操作の意味を明示する（見た目のタイトル文字列
    // だけでは、押すと何が起きるかが伝わらないため）。視覚順（タイトル -> 相対時刻 ->
    // ブランチ -> 解析エラー）をそのまま読み上げ順にする。解析エラーは可視テキストと
    // 同じ要約を読み上げる（詳細な生エラー文言はツールチップのみで、ホバーできない
    // 利用者にとっては「打つ手が無い情報」を長く読み上げられても負担なだけのため）。
    const ariaLabel = [
      displayTitle,
      formatRelativeTime(entry.updatedAt),
      entry.gitBranch,
      entry.parseError !== undefined ? '内容を読めませんでした、再開はできます' : undefined,
      '再開する',
    ]
      .filter((part): part is string => part !== undefined && part !== '')
      .join('、');

    return (
      <div className="history-item__content">
        <button
          type="button"
          className="history-item__row"
          aria-label={ariaLabel}
          onClick={() => onResume(entry)}
        >
          <div className="history-item__title">{displayTitle}</div>
          {renderMeta(entry)}
        </button>
        {stableId !== undefined && (
          <div className="history-item__actions">
            <button
              type="button"
              className="history-item__action"
              aria-label="メモを開く"
              onClick={(e: MouseEvent<HTMLButtonElement>) => {
                // メモを開くだけで resume は走らせない。
                e.stopPropagation();
                onOpenMemo({ provider: entry.provider, stableId, title: displayTitle });
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
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="history-list">
      {/* 見出しは「何のパネルか」（タブに既に書いてある）ではなく「いまどの範囲を
          見ているか」を言う。設定の「このフォルダのものだけ表示する」と語を揃えてある。

          Issue #119 周3: **プロバイダも入れた。** すぐ下のツールバーに
          Claude / Gemini のトグルが見えているのに、見出しは範囲しか言っていなかった。
          3パネルで語の形（`この/すべての + 範囲 + の + 対象`）を揃えるため、
          クラスも `.panel-scope` に寄せてある（タスク・メモと同じ見た目）。 */}
      <h2 className="panel-scope">
        {showingAllFolders ? 'すべてのフォルダ' : 'このフォルダ'}の{' '}
        {provider === 'claude' ? 'Claude' : 'Gemini'}
      </h2>
      <div className="history-list__toolbar">
        {/*
          ⛔ **選択状態を `aria-pressed` で露出する**（Issue #155 の design-review）。
          見た目は `.is-active`（文字色と枠）だけで、支援技術には**どちらが選ばれているか
          一切伝わっていなかった**。タブを閉じたときの告知が「履歴から再開できます」と
          言う以上、その行き先のトグルが読めないと導線が切れる。
          ⛔ `role="tab"` にはしない（tablist の相互排他とキーボード操作の契約が付いてくる。
          ここはサイドバー本体のタブ（`Sidebar.tsx`）と入れ子になり、意味が濁る）。
        */}
        <div className="history-list__providers">
          <button
            type="button"
            aria-pressed={provider === 'claude'}
            className={provider === 'claude' ? 'is-active' : ''}
            onClick={() => {
              setProvider('claude');
              setAllFolders(false);
            }}
          >
            Claude
          </button>
          <button
            type="button"
            aria-pressed={provider === 'gemini'}
            className={provider === 'gemini' ? 'is-active' : ''}
            onClick={() => {
              setProvider('gemini');
              setAllFolders(false);
            }}
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

      {/* 自分で切り替えた結果を戻す手段。
          Issue #119 周3: **「すべてのフォルダを表示中」という語を落とした。**
          すぐ上のスコープ行（`.panel-scope`）が同じことを言っており、
          同じ内容が縦に2回並んでいた（#117 が見出しを足したときに、ここを畳み忘れた）。 */}
      {showingAllFolders && (
        <div className="history-list__scope-note">
          <button type="button" onClick={() => setAllFolders(false)}>
            現在のフォルダのみに戻す
          </button>
        </div>
      )}

      {!cwdReady && <div className="panel-message">作業ディレクトリを取得中...</div>}
      {cwdReady && error && (
        <div className="panel-message panel-message--error">履歴の取得に失敗しました: {error}</div>
      )}
      {cwdReady && !error && !loading && entries.length === 0 && (
        <div className="panel-message panel-empty">
          {allFolders ? (
            <p className="panel-empty__body">セッションがまだありません</p>
          ) : (
            <>
              <p className="panel-empty__body">このフォルダには過去のセッションがありません</p>
              <p className="panel-empty__path" title={getSharedCwd() ?? ''}>
                {getSharedCwd() ?? ''}
              </p>
              {provider === 'claude' && (
                <button
                  type="button"
                  className="panel-empty__action"
                  onClick={() => setAllFolders(true)}
                >
                  すべてのフォルダを見る
                </button>
              )}
            </>
          )}
        </div>
      )}

      <ul>
        {cwdReady &&
          entries.map((entry) => (
            <li key={entry.sessionId} className="history-item">
              {renderEntry(entry)}
            </li>
          ))}
      </ul>
    </div>
  );
}
