// タブバー。「+」で新しいシェルタブを開き、各タブの「x」で閉じる。
// タイトルをダブルクリックするとインライン編集できる。
// ウィンドウのドラッグ領域も兼ねる（タブ・ボタン部分は no-drag）。
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

import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import type { TabState } from './useTabs';
import { isCloseTabKey, isRovingTabindexKey, nextRovingTabindex } from './rovingTabindex';
import { tabButtonId, tabPanelId } from './tabAriaIds';

export interface TabBarProps {
  tabs: TabState[];
  activeTabId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNewShell: () => void;
  onRename: (id: string, title: string) => void;
  onOpenSettings: () => void;
}

export default function TabBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onNewShell,
  onRename,
  onOpenSettings,
}: TabBarProps) {
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
    setDraft(tab.title);
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
            return (
              <div
                key={tab.id}
                className={`tab-bar__tab${isActive ? ' is-active' : ''}${
                  tab.exit ? ' is-exited' : ''
                }`}
              >
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
                  >
                    <span
                      className="tab-bar__title"
                      onDoubleClick={(e: MouseEvent<HTMLSpanElement>) => {
                        e.stopPropagation();
                        startEditing(tab);
                      }}
                    >
                      {tab.title}
                    </span>
                    {tab.exit && <span className="tab-bar__exit-badge">終了</span>}
                  </button>
                )}
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
                  aria-label="タブを閉じる"
                  title="タブを閉じる"
                >
                  x
                </button>
              </div>
            );
          })}
        </div>
        <button className="tab-bar__new" onClick={onNewShell} aria-label="新しいシェルタブ" title="新しいシェルタブ">
          +
        </button>
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
