// タブバー。「+ ▾」で新しいタブ（シェル / Claude / Gemini）を開き、各タブの「x」で閉じる。
// タイトルをダブルクリックするとインライン編集できる。
// ウィンドウのドラッグ領域も兼ねる（タブ・ボタン部分は no-drag）。
//
// Issue #20 PR 12（I-1）: 「+」は newShellTab 固定で、Claude / Gemini を起動できるのは
// メニュー（menu.ts）とショートカット（Cmd+Shift+C / Cmd+Shift+E）だけだった。
// 説明書を読まない初見ユーザーが画面上でこのアプリの存在理由（AI CLI を飼う）に
// 到達する手段が無かったため、「+」を分割ボタン化する。
// メニューボタンパターン（WAI-ARIA APG）に沿い、開いたら最初の項目にフォーカス・
// 外側クリックと Escape で閉じる・矢印キーで項目間を移動できるようにする。
//
// Issue #20 PR 9: タブは `<div onClick>` のままではキーボード（Tab）で
// 到達できなかった。`role="tablist"` / `role="tab"` を正しい親子関係で持たせ、
// roving tabindex で矢印キー移動を実装する。
//
// 閉じるボタンは role="tab" の <button> に**入れ子にしない**
// （<button> の内容モデルはインタラクティブ要素を許さない。history-item__row /
// task-item__row と同じ理由）。そのためタブ行の親 div（.tab-bar__tab）の中に、
// 選択用の <button role="tab"> と閉じる用の <button> を兄弟として並べる。
//
// レビュー指摘1（e2e S51 が検出）: 閉じるボタンに tabIndex を明示していなかった
// ため既定値 0 のままで、タブが N 枚あると Tab の停止点が「role="tab" 1個 +
// 閉じるボタン N個」になっていた（roving tabindex で「停止点は1つ」にした
// 意味が無い）。閉じるボタンは tabIndex={-1} にして停止点から外す一方、
// 「キーボードだけでタブを閉じる」能力を後退させないため、role="tab" の
// ボタンにフォーカスがある状態で Delete / Backspace を押すとそのタブを
// 閉じられるようにする（WAI-ARIA APG のタブパターンが推奨する方式）。
//
// レビュー指摘2: 最初は矢印キーで「移動 = 選択」の automatic activation で
// 実装したが、TerminalPane.tsx の `if (!active) return; handle.focus();`
// （アクティブになったタブのターミナルへ毎回フォーカスする既存の仕組み。
// 全タブが常にマウント済みなので必ず発火する）が選択の変化のたびに発火し、
// フォーカスを端末側へ奪う。xterm は Tab を自前で処理するため、一度奪われると
// キーボードだけではタブリストへ戻れず、**矢印キーでの移動が実質1ホップに
// 制限される**（roving tabindex を入れた意味がほぼ無くなる）。
// WAI-ARIA APG は「activate でフォーカスが移る／コストがかかる場合は
// manual activation を使う」としており、ここはまさにその条件に当てはまる。
// そのため矢印キー / Home / End は**フォーカスだけ**を動かし、`onSelect` は
// 呼ばない（tabIndex=0 は「フォーカスされているタブ」に付け、選択状態
// （aria-selected・is-active）とは独立に動く）。実際に選択するのは
// Enter / Space（ネイティブの <button> が標準で持つ挙動 -> onClick を発火
// させるだけで済み、ここで明示的なハンドリングは要らない）。
// TerminalPane.tsx 側のフォーカス処理そのものは直さない（クリックを含む
// アプリ全体の既存設計として正しい。「選んだら打てる」）。
//
// Issue #20 PR 10: 閉じるボタンをトレーリング側（右・常時表示）からリーディング側
// （左）へ移し、ホバー時とアクティブ時にだけ見えるようにした（Terminal.app /
// Safari と同じ配置。CSS 側は opacity と pointer-events の両方を切り替える。
// opacity だけだと非表示のあいだも当たり判定が反応してしまい、常時表示していた
// 頃と実害が変わらない）。閉じるボタンの tabIndex={-1} と Delete / Backspace
// 経路（PR 9）は表示条件と無関係に動くため、キーボード操作性は変わらない。
// あわせて先頭に状態専用の固定幅スロットを追加した（終了マークのみ実装。
// 「あなたの番」ドットの配線は別 PR）。
//
// レビュー差し戻し: タブタイトルの既定を basename(cwd) にした結果、同じ
// リポジトリで claude と gemini を1本ずつ開くとタイトルが両方とも同じ文字列に
// なり、プロバイダを見分ける手がかりが画面から消えていた（文字マーク $/C/G は
// 却下済み、色相は未実装のままだった）。Issue #20 C の設計は
// 「タイトルは basename(cwd)、プロバイダはタブ自体の色相」を**セット**で
// 解く前提だったため、`tab-bar__tab--${kind}` クラス（styles.css の
// `--tab-provider-*` トークンで色を持つ）を追加した。
// **色相だけに頼らない**（デザイン原則2: 色覚特性下では色相が消える。PR 8 で
// 初版の提案色が1型色覚下でむしろ悪化した実例がある）。そのため
// `providerLabel()` を title 属性（ツールチップ）と role="tab" の
// アクセシブルネームの両方に添える。aria-label を使うので、可視テキスト
// （タブタイトル）を先頭にそのまま含める（WCAG 2.5.3 Label in Name。
// 可視テキストとアクセシブルネームが食い違うと音声操作が壊れる）。
// **残る限界**: ツールチップは常時可視ではない（ホバーで初めて出る）ため、
// 色覚特性を持つ晴眼のユーザーは、ホバーするまでプロバイダを色以外の手段で
// 判別できない。文字マークとタブ最小幅の拡大はどちらも却下済みなので、
// この限界は解消しようとせず記録するに留める
// （.claude/workspace/issue-20/known-issues.md 参照）。

import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { flattenPaneTree } from './paneTree';
import { isCloseTabKey, isRovingTabindexKey, nextRovingTabindex } from './rovingTabindex';
import { tabButtonId, tabPanelId } from './tabAriaIds';
import { tabLeaf, type TabState } from './tabPane';
import { providerLabel } from './tabProvider';

/**
 * タブバーの x ボタンのラベル（Issue #56 PR 8・design-review.md 提案 E'）。
 *
 * `Cmd+Shift+W` を新設していないため、このボタンがマウス経由で複数の PTY を
 * 一度に閉じられる唯一の抜け穴になる。`title` / `aria-label` にペイン数を
 * 出しておくことで、押す前に「何本のプロセスが道連れになるか」が分かる
 * （実際の確認ダイアログは App.tsx の requestCloseTab が2ペイン以上のときだけ出す）。
 * `src/main/menu.ts` の `closeTabLabel` と同じ文言・同じ条件（プロセス構造が
 * Main / Renderer の別プロセスにまたがるため、小さな文字列組み立ては
 * やむを得ず両側に持つ。C.f. `PaneSplitDirection` を ipc.ts に再宣言している事情と同種）。
 */
function closeTabButtonLabel(paneCount: number): string {
  return paneCount > 1 ? `タブを閉じる（${paneCount} ペイン）` : 'タブを閉じる';
}

export interface TabBarProps {
  tabs: TabState[];
  activeTabId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNewShell: () => void;
  /** Issue #20 I-1: 「+」を分割ボタン化する。Claude / Gemini はメニュー・
   * ショートカット（Cmd+Shift+C / Cmd+Shift+E）専用の導線だったため、画面上に
   * 導線を追加する */
  onNewClaude: () => void;
  onNewGemini: () => void;
  onRename: (id: string, title: string) => void;
  onOpenSettings: () => void;
}

export default function TabBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onNewShell,
  onNewClaude,
  onNewGemini,
  onRename,
  onOpenSettings,
}: TabBarProps) {
  // 「+ ▾」分割ボタンのドロップダウンメニュー開閉状態（Issue #20 I-1）。
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const newMenuRef = useRef<HTMLDivElement | null>(null);
  const newButtonRef = useRef<HTMLButtonElement | null>(null);
  const firstMenuItemRef = useRef<HTMLButtonElement | null>(null);
  // 編集中のタブ ID と、編集中の下書き文字列。編集中でなければ editingTabId は null。
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  // editingTabId の state 更新は非同期なので、Enter -> blur のように同一ティック内で
  // 二重確定を防ぎたい箇所は、同期的に更新できるこの ref を見て判定する。
  const editingTabIdRef = useRef<string | null>(null);

  // roving tabindex の「フォーカスされているタブ」（manual activation）。
  // 選択状態（activeTabId / aria-selected）とは独立に動く。矢印キーでの
  // 移動はこの state だけを更新し、Enter / Space で初めて選択（onSelect）が
  // 呼ばれる。
  const [focusedTabId, setFocusedTabId] = useState<string | null>(activeTabId);

  // role="tab" の <button> への参照。矢印キーで隣のタブへ移るとき、実際に
  // DOM フォーカスもそちらへ送る（roving tabindex はどのタブが tabIndex 0 か
  // を切り替えるだけで、フォーカス移動そのものは自前で行う必要がある）。
  const tabButtonRefs = useRef(new Map<string, HTMLButtonElement>());

  const setEditing = (id: string | null): void => {
    editingTabIdRef.current = id;
    setEditingTabId(id);
  };

  // 「+ ▾」メニューが開いている間だけ、外側クリックと Escape を監視して閉じる。
  // WAI-ARIA APG のメニューボタンパターン（開いたら最初の項目にフォーカス、
  // Escape で閉じてトリガーへフォーカスを戻す）に合わせる。
  useEffect(() => {
    if (!newMenuOpen) return;
    firstMenuItemRef.current?.focus();

    // document 側は React の合成イベントではなく DOM ネイティブのイベントなので、
    // このファイルが `react` から import している KeyboardEvent / MouseEvent
    // （JSX の onKeyDown 等に使う合成イベント型）とは別物。globalThis 経由で
    // DOM 側の型を明示的に指定する。
    const handlePointerDown = (e: globalThis.MouseEvent): void => {
      const target = e.target as Node;
      if (newMenuRef.current?.contains(target)) return;
      if (newButtonRef.current?.contains(target)) return;
      setNewMenuOpen(false);
    };
    const handleKeyDown = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      setNewMenuOpen(false);
      newButtonRef.current?.focus();
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [newMenuOpen]);

  /** メニュー項目内の矢印キーによる移動（3項目の循環）。 */
  const handleNewMenuItemKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = newMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    if (!items || items.length === 0) return;
    const delta = e.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = (index + delta + items.length) % items.length;
    items[nextIndex]?.focus();
  };

  /** メニュー項目を選んだときの共通処理。メニューを閉じてトリガーへフォーカスを戻す。 */
  const selectNewMenuItem = (action: () => void): void => {
    setNewMenuOpen(false);
    newButtonRef.current?.focus();
    action();
  };

  // タブが閉じられるなどして編集中のタブが消えたら、編集状態を破棄する。
  useEffect(() => {
    if (editingTabId !== null && !tabs.some((t) => t.id === editingTabId)) {
      setEditing(null);
    }
  }, [tabs, editingTabId]);

  // 選択（activeTabId）が変わったら、roving tabindex の位置もそれに合わせる。
  // 矢印キーでの移動は onSelect を呼ばない（= activeTabId を変えない）ため、
  // この効果は「クリック・Cmd+1-9・Enter/Space での選択・タブを閉じた結果の
  // 選び直し」といった**外部要因**でだけ発火する。
  //
  // タブリストから離れて戻ってきたときに tabIndex=0 がどこにあるべきかは、
  // ここで「選択中のタブ」に決めている（矢印キーでの一時的な移動先を
  // 覚え続ける案もあったが、選択とは無関係にクリックした場合や Cmd+1-9 で
  // 切り替えた場合に、次に Tab で戻ってきたとき無関係な位置に止まるほうが
  // 驚きが大きいと判断した）。
  useEffect(() => {
    setFocusedTabId(activeTabId);
  }, [activeTabId]);

  // 矢印キーで移動した先のタブが、その後（マウスでの閉じる操作などで）
  // 消えた場合のフォールバック。tabs が変わったときだけ見る。
  useEffect(() => {
    if (focusedTabId !== null && !tabs.some((t) => t.id === focusedTabId)) {
      setFocusedTabId(activeTabId);
    }
  }, [tabs, focusedTabId, activeTabId]);

  const startEditing = (tab: TabState): void => {
    setEditing(tab.id);
    setDraft(tabLeaf(tab).title);
  };

  const commitEditing = (): void => {
    if (editingTabIdRef.current === null) return;
    onRename(editingTabIdRef.current, draft);
    setEditing(null);
  };

  const cancelEditing = (): void => {
    setEditing(null);
  };

  // 矢印キー / Home / End でタブ間の roving tabindex を進める（manual
  // activation: 移動はフォーカスだけで、選択は変えない）。Delete / Backspace は
  // **フォーカス中の**タブを閉じる（選択中のタブとは限らない。閉じるボタンが
  // tabIndex={-1} で Tab の停止点から外れている代わりの経路。WAI-ARIA APG の
  // タブパターン）。Enter / Space はここで扱わない。フォーカス中の
  // <button role="tab"> がネイティブの button として標準で click（onSelect）
  // を発火するので、明示的なハンドリングを書くと二重発火する。
  const handleTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (isCloseTabKey(e.key)) {
      e.preventDefault();
      const tab = tabs[index];
      if (!tab) return;
      onClose(tab.id);
      return;
    }
    if (!isRovingTabindexKey(e.key)) return;
    e.preventDefault();
    const nextIndex = nextRovingTabindex(index, e.key, tabs.length);
    const next = tabs[nextIndex];
    if (!next) return;
    setFocusedTabId(next.id);
    tabButtonRefs.current.get(next.id)?.focus();
  };

  return (
    <div className="tab-bar">
      <div className="tab-bar__tabs">
        <div className="tab-bar__tablist" role="tablist" aria-orientation="horizontal" aria-label="開いているタブ">
          {tabs.map((tab, index) => {
            const isEditing = tab.id === editingTabId;
            const isActive = tab.id === activeTabId;
            // PTY のメタ（title / kind / exit）は leaf に持たせてある
            // （design-review Q4）ので、タブ自体からではなく tabLeaf() で
            // leaf を引いてから読む。木は常に leaf 1枚（PR 3）。
            const leaf = tabLeaf(tab);
            const provider = providerLabel(leaf.ptyKind);
            // x ボタンが複数 PTY を一度に閉じる抜け穴にならないよう、押す前に
            // ペイン数が分かるようにする（design-review.md 提案 E'）。
            const paneCount = flattenPaneTree(tab.layout).length;
            const closeLabel = closeTabButtonLabel(paneCount);
            // 可視テキスト（タブタイトル）を先頭に含める（WCAG 2.5.3 Label in
            // Name）。aria-label を使うとボタンの子要素のテキストは無視される
            // ため、タイトル・プロバイダ・終了状態のすべてをここで組み立て直す。
            const tabAccessibleLabel = [leaf.title, provider, leaf.exit ? '終了' : undefined]
              .filter((part): part is string => part !== undefined && part !== '')
              .join('、');
            return (
              <div
                key={tab.id}
                className={`tab-bar__tab tab-bar__tab--${leaf.ptyKind}${isActive ? ' is-active' : ''}${
                  leaf.exit ? ' is-exited' : ''
                }`}
              >
                {/* 先頭の固定幅スロット。状態専用（Issue #20 C）。プロバイダの区別は
                    タブ自体の色相に譲り、ここでは「あなたの番／通常／終了」だけを表す。
                    「あなたの番」ドットの配線は別 PR（タスク一覧の購読を TabBar 側にも
                    持ち込む必要があり、この PR の見積もりを超えるため見送った。詳細は
                    このタブの実装 PR の報告を参照）。ここでは終了マークのみ実装する。
                    装飾要素なので aria-hidden にする（「終了」は下の末尾バッジが
                    テキストとして既に伝えている）。 */}
                <span
                  className={`tab-bar__state-slot${leaf.exit ? ' tab-bar__state-slot--exited' : ''}`}
                  aria-hidden="true"
                />
                <button
                  className="tab-bar__close"
                  // role="tab" のタブリストは「停止点が1つ」であるべき（roving
                  // tabindex）。閉じるボタンは既定の tabIndex 0 のままだと
                  // タブの枚数だけ余分な停止点を作ってしまうため、明示的に
                  // 外す。キーボードから閉じる手段は role="tab" 側の
                  // Delete / Backspace に用意してある（マウスでの操作性は
                  // このボタンのまま変わらない）。
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(tab.id);
                  }}
                  aria-label={closeLabel}
                  title={closeLabel}
                >
                  x
                </button>
                {isEditing ? (
                  <input
                    className="tab-bar__title-input"
                    aria-label="タブ名を編集"
                    value={draft}
                    autoFocus
                    onFocus={(e: FocusEvent<HTMLInputElement>) => e.currentTarget.select()}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                      if (e.key === 'Enter') {
                        // IME の変換確定の Enter では編集を確定しない。
                        if (e.nativeEvent.isComposing) return;
                        e.preventDefault();
                        // blur が発火して onBlur の二重確定にならないよう、
                        // 確定を先に済ませてから編集状態を抜ける。
                        commitEditing();
                        e.currentTarget.blur();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelEditing();
                        e.currentTarget.blur();
                      }
                    }}
                    onBlur={() => {
                      // Enter/Escape で既に確定・キャンセル済み（ref が変わっている）なら何もしない。
                      if (editingTabIdRef.current === tab.id) commitEditing();
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    role="tab"
                    id={tabButtonId(tab.id)}
                    aria-controls={tabPanelId(tab.id)}
                    aria-selected={isActive}
                    // roving tabindex は「フォーカスされているタブ」に付く。
                    // 選択中（isActive）とは独立（manual activation）。
                    tabIndex={tab.id === focusedTabId ? 0 : -1}
                    ref={(el) => {
                      if (el) tabButtonRefs.current.set(tab.id, el);
                      else tabButtonRefs.current.delete(tab.id);
                    }}
                    className="tab-bar__tab-button"
                    onClick={() => onSelect(tab.id)}
                    onKeyDown={(e) => handleTabKeyDown(e, index)}
                    // プロバイダは色相だけに頼らない（原則2）。ツールチップに
                    // プロバイダ名を出し、アクセシブルネームにも含める
                    // （tabAccessibleLabel は可視テキストを先頭に持つ）。
                    title={provider}
                    aria-label={tabAccessibleLabel}
                  >
                    <span
                      className="tab-bar__title"
                      onDoubleClick={(e: MouseEvent<HTMLSpanElement>) => {
                        e.stopPropagation();
                        startEditing(tab);
                      }}
                    >
                      {leaf.title}
                    </span>
                    {leaf.exit && <span className="tab-bar__exit-badge">終了</span>}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div className="tab-bar__new-wrapper">
          <button
            ref={newButtonRef}
            type="button"
            className="tab-bar__new"
            aria-haspopup="menu"
            aria-expanded={newMenuOpen}
            aria-label="新しいタブを開く"
            title="新しいタブを開く"
            onClick={() => setNewMenuOpen((open) => !open)}
          >
            <span aria-hidden="true">+</span>
            <span className="tab-bar__new-caret" aria-hidden="true">
              ▾
            </span>
          </button>
          {newMenuOpen && (
            <div
              className="tab-bar__new-menu"
              role="menu"
              aria-label="新しいタブの種類"
              ref={newMenuRef}
            >
              <button
                type="button"
                role="menuitem"
                className="tab-bar__new-menu-item"
                ref={firstMenuItemRef}
                onClick={() => selectNewMenuItem(onNewShell)}
                onKeyDown={(e) => handleNewMenuItemKeyDown(e, 0)}
              >
                新しいシェル
              </button>
              <button
                type="button"
                role="menuitem"
                className="tab-bar__new-menu-item"
                onClick={() => selectNewMenuItem(onNewClaude)}
                onKeyDown={(e) => handleNewMenuItemKeyDown(e, 1)}
              >
                Claude
              </button>
              <button
                type="button"
                role="menuitem"
                className="tab-bar__new-menu-item"
                onClick={() => selectNewMenuItem(onNewGemini)}
                onKeyDown={(e) => handleNewMenuItemKeyDown(e, 2)}
              >
                Gemini
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="tab-bar__drag-region" />
      <button
        className="tab-bar__settings"
        onClick={onOpenSettings}
        aria-label="設定を開く"
        title="設定を開く (Cmd+,)"
      >
        設定
      </button>
    </div>
  );
}
