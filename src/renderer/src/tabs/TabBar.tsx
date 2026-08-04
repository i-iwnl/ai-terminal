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
import {
  tabExitState,
  tabDisplayTitle,
  tabLeaf,
  tabRepresentativeLeaf,
  type TabState,
} from './tabPane';
import { providerLabel } from './tabProvider';
// 「あなたの番」の判定は tabYourTurn.ts が唯一の正（Cmd+J と同じ関数を使う。
// ここで独自に status を解釈すると、状態の意味が2箇所に散る）。
import { tabHasYourTurn, yourTurnSessionIds } from './tabYourTurn';
// タスク一覧の購読は共有ハブに委ねる（TaskList / App.tsx と同じスナップショットを
// 見る必要がある。lib/agentTasksStore.ts 参照）。ここで window.api.agents を
// 直接叩くと、ポーリングの購読者が1つ増える。
import { subscribeAgentTasks } from '../lib/agentTasksStore';

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
  /**
   * サイドバーを畳んでいるか（Cmd+Option+S。Issue #20 K-1）。
   *
   * 畳むとサイドバー（と、その中で信号機ボタンの下敷きになっていた
   * `.sidebar__drag-region`）が幅0になり、**macOS の信号機ボタンがそのまま
   * タブバーの上に乗る**。信号機はネイティブのボタンで DOM には存在しないため、
   * 1枚目のタブは「押しても信号機に吸われる」領域を抱えることになる。
   * そこで畳んでいる間だけ、タブの手前に信号機ぶんの逃げ帯
   * （`.tab-bar__traffic-light-gap`）を出す。幅の根拠は styles.css 側のコメント。
   */
  sidebarCollapsed: boolean;
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
  /**
   * タブ自身の名前の確定（Issue #131）。**タブのダブルクリックはこちらを呼ぶ。**
   * 押した対象（タブ）と変わるもの（タブの名前）を一致させる
   * （Issue #130 の時点では、タブを押しているのにペインが書き換わっていた）。
   */
  onRenameTab: (tabId: string, title: string) => void;
  /**
   * ペインの名前の確定（Issue #130）。**タブ名とは別物**で、こちらは
   * メニューの「ペイン名を変更...」からだけ呼ばれる。
   */
  onRenamePane: (tabId: string, paneId: string, title: string) => void;
  /**
   * 外から（メニューの「ペイン名を変更...」）**ペイン名の**編集を始めるための購読登録。
   *
   * **編集中の下書き文字列は TabBar が持つ**（App へ持ち上げると、タブの
   * 再描画のたびに入力途中の文字が失われる）。App 側はこの関数で
   * 「編集を始めたい」を伝えるだけ。`Sidebar` の `registerPanelSwitcher` と同じ形。
   */
  registerRenameStarter?: (startRename: ((tabId: string) => void) | null) => void;
  onOpenSettings: () => void;
}

export default function TabBar({
  sidebarCollapsed,
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onNewShell,
  onNewClaude,
  onNewGemini,
  onRenameTab,
  onRenamePane,
  registerRenameStarter,
  onOpenSettings,
}: TabBarProps) {
  // 「+ ▾」分割ボタンのドロップダウンメニュー開閉状態（Issue #20 I-1）。
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  // 「あなたの番」のセッション id（Issue #119 周5 / #20 の B-3）。
  //
  // `.tab-bar__state-slot` は PR #108 で幅だけ確保されて**空のまま**だった。
  // Dock バッジが「3件待っている」と言うのに、ウィンドウを見てもどのタブか
  // 分からない状態を直す。ターミナルを見ている視線の高さに出る唯一の層。
  const [yourTurnIds, setYourTurnIds] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    return subscribeAgentTasks((e) => setYourTurnIds(yourTurnSessionIds(e.tasks)));
  }, []);
  const newMenuRef = useRef<HTMLDivElement | null>(null);
  const newButtonRef = useRef<HTMLButtonElement | null>(null);
  const firstMenuItemRef = useRef<HTMLButtonElement | null>(null);
  // 編集中のタブ ID と、編集中の下書き文字列。編集中でなければ editingTabId は null。
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  // editingTabId の state 更新は非同期なので、Enter -> blur のように同一ティック内で
  // 二重確定を防ぎたい箇所は、同期的に更新できるこの ref を見て判定する。
  const editingTabIdRef = useRef<string | null>(null);
  // 編集を始めた時点のペイン ID（Issue #130）。
  //
  // **確定時に引き直さない。** `commitEditing` は `tab` を見ていないので
  // `tabLeaf(tab)` を呼べないという実装上の都合もあるが、本質的な理由は別で、
  // 編集中に別のペインへフォーカスが移りうる（メニュー・通知クリック経由）。
  // 確定の瞬間のアクティブペインへ書くと、**入力欄に出ていた名前とは別の
  // ペインの名前が書き換わる**。開始時点の対象を持ち回るのが正しい。
  const editingPaneIdRef = useRef<string | null>(null);
  // 何の名前を編集しているか（Issue #131）。**入力欄の見た目は同じでも、
  // 確定先が違う。** タブのダブルクリックは 'tab'、メニューの
  // 「ペイン名を変更...」は 'pane'。aria-label もこれで出し分ける
  // （画面の語と、実際に変わるものを食い違わせない）。
  const [editingTarget, setEditingTarget] = useState<'tab' | 'pane'>('tab');
  const editingTargetRef = useRef<'tab' | 'pane'>('tab');

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

  // メニューの「ペイン名を変更...」から編集を始める（Issue #130）。
  // **アンマウント時に必ず解除する**（App 側が古い関数を掴んだままにしない。
  // Sidebar の registerPanelSwitcher と同じ理由）。
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  useEffect(() => {
    registerRenameStarter?.((tabId: string) => {
      const tab = tabsRef.current.find((t) => t.id === tabId);
      if (tab === undefined) return;
      startEditing(tab, 'pane');
    });
    // **依存配列は registerRenameStarter だけ（意図的）。** ここで捕まえる
    // startEditing は毎レンダリングで作り直される素の関数だが、その中身は
    // setState 群と ref だけで、可変な値は tabsRef 経由で常に最新を引く。
    // tabs を依存に入れると、タブが1枚増減するたびに登録し直すことになる。
    return () => registerRenameStarter?.(null);
  }, [registerRenameStarter]);

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

  const startEditing = (tab: TabState, target: 'tab' | 'pane'): void => {
    setEditing(tab.id);
    setEditingTarget(target);
    editingTargetRef.current = target;
    if (target === 'tab') {
      editingPaneIdRef.current = null;
      // 下書きは**いま画面に出ている見出し**（導出値を含む）にする。
      // 未設定のタブを編集し始めたとき、空欄ではなく既定値から直せる。
      setDraft(tabDisplayTitle(tab));
    } else {
      const leaf = tabLeaf(tab);
      editingPaneIdRef.current = leaf.paneId;
      setDraft(leaf.title);
    }
  };

  const commitEditing = (): void => {
    const tabId = editingTabIdRef.current;
    if (tabId === null) return;
    if (editingTargetRef.current === 'tab') {
      onRenameTab(tabId, draft);
    } else {
      const paneId = editingPaneIdRef.current;
      if (paneId !== null) onRenamePane(tabId, paneId, draft);
    }
    setEditing(null);
    editingPaneIdRef.current = null;
  };

  const cancelEditing = (): void => {
    setEditing(null);
    editingPaneIdRef.current = null;
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
      {sidebarCollapsed && (
        // 信号機ボタンの逃げ帯（Issue #20 K-1）。畳んでいる間だけ出す。
        // `-webkit-app-region: drag` を付けてあるので、`.sidebar__drag-region` を
        // 失っている間もここからウィンドウを動かせる（タブが増えて
        // `.tab-bar__drag-region` の実幅が 0 になっても、この帯は残る）。
        // 見た目は持たない（塗りも線も無い）ので、既定の表示は1pxも変わらない。
        <div className="tab-bar__traffic-light-gap" />
      )}
      <div className="tab-bar__tabs">
        <div className="tab-bar__tablist" role="tablist" aria-orientation="horizontal" aria-label="開いているタブ">
          {tabs.map((tab, index) => {
            const isEditing = tab.id === editingTabId;
            const isActive = tab.id === activeTabId;
            // PTY のメタ（title / kind / exit）は leaf に持たせてある
            // （design-review Q4）ので、タブ自体からではなく leaf を引いてから読む。
            // **識別（何のタブか）と状態（終了・あなたの番）で引き先を分ける**
            // （Issue #131）。識別は木の先頭 leaf を代表として使い、`Cmd+]` で
            // 動かないようにする。**状態はどちらも木の全 leaf を見る**（Issue #142）。
            // 量化子だけが違う: あなたの番は `some`（1つでも待っていれば待っている）、
            // 終了は `every`（`issue-56/design-review.md:81` の確定仕様）。
            // **この行より下で `tabLeaf(tab)`（アクティブなペイン）を読まない。**
            // 読むと `Cmd+]` を押しただけで表示が変わる（#131 / #142 で直した不具合）。
            const repLeaf = tabRepresentativeLeaf(tab);
            const displayTitle = tabDisplayTitle(tab);
            const provider = providerLabel(repLeaf.ptyKind);
            // x ボタンが複数 PTY を一度に閉じる抜け穴にならないよう、押す前に
            // ペイン数が分かるようにする（design-review.md 提案 E'）。
            const paneCount = flattenPaneTree(tab.layout).length;
            const closeLabel = closeTabButtonLabel(paneCount);
            // 可視テキスト（タブタイトル）を先頭に含める（WCAG 2.5.3 Label in
            // Name）。aria-label を使うとボタンの子要素のテキストは無視される
            // ため、タイトル・プロバイダ・終了状態のすべてをここで組み立て直す。
            // 「あなたの番」はドット（丸）だけでなく**語でも伝える**（原則2:
            // 色相の違いは手がかりに数えない）。終了マーク（四角）とは形も違う。
            const isYourTurn = tabHasYourTurn(tab.layout, yourTurnIds);
            // Issue #166: 終了は「終わったか」と「異常だったか」の2軸になった。
            // **`allExited` の意味は変えない**（全ペインが終了したか）。severity は
            // `isAbnormal` が別に持つ。クラス名は下で1箇所だけ組み立てる
            // （状態名をクラス文字列へ機械的に写すと、片方を改名したときに
            // もう片方が黙って追随せず、TypeScript も何も言わない）。
            const exitState = tabExitState(tab.layout);
            const allExited = exitState !== 'running';
            const isAbnormal = exitState === 'exited-abnormal';
            const tabAccessibleLabel = [
              displayTitle,
              provider,
              isYourTurn ? 'あなたの番' : undefined,
              allExited ? '終了' : undefined,
            ]
              .filter((part): part is string => part !== undefined && part !== '')
              .join('、');
            return (
              <div
                key={tab.id}
                className={`tab-bar__tab tab-bar__tab--${repLeaf.ptyKind}${isActive ? ' is-active' : ''}${
                  allExited ? ' is-exited' : ''
                }${isAbnormal ? ' is-exited-abnormal' : ''}`}
              >
                {/* 先頭の固定幅スロット。状態専用（Issue #20 C）。プロバイダの区別は
                    タブ自体の色相に譲り、ここでは「あなたの番／通常／終了」だけを表す。
                    **Issue #119 の周5 で「あなたの番」を配線した**（PR #108 で幅だけ
                    確保されて空のままだった）。終了（四角）とあなたの番（丸）は
                    形が違うので、色に頼らずに区別できる（原則2）。
                    **終了を優先する**（プロセスが終わっているタブに「あなたの番」の
                    ドットを出しても、押した先で入力できない）。
                    **この優先順位があるから、終了は `every` でなければならない**
                    （Issue #142）。`some` にすると「claude があなたの番 + 隣の zsh を
                    exit した」タブで終了が勝ち、押せば入力できるのに
                    あなたの番のドットが消える。
                    装飾要素なので aria-hidden にする。語のほうは
                    tabAccessibleLabel が持つ（「終了」は末尾バッジも伝えている）。

                    **Issue #166: 正常終了はここに何も出さない。** severity を色の
                    2値（中立 / 赤）で表す案は design-review で3人が独立に却下した。
                    高コントラストでは面が明るくなるぶん両者が等輝度に潰れ
                    （色覚特性下では既定でも潰れる）、しかも中立色は「あなたの番」の
                    橙と輝度が並ぶ。**層を1つ減らすほうが、新トークン・@media の追随・
                    コントラストの検算のすべてを同時に消せる。**
                    正常終了を運ぶのは末尾バッジの語と aria-label で、
                    macOS 純正のターミナルも正常終了にはピクセルを割いていない。

                    ⛔ **`allExited` の分岐の中で畳むこと。** 素直に
                    `isAbnormal ? ... : isYourTurn ? ...` と書くと、
                    **正常終了したタブに「あなたの番」のドットが復活する**
                    （上の優先順位そのものが壊れる）。 */}
                <span
                  className={`tab-bar__state-slot${
                    allExited
                      ? isAbnormal
                        ? ' tab-bar__state-slot--exited'
                        : ''
                      : isYourTurn
                        ? ' tab-bar__state-slot--your-turn'
                        : ''
                  }`}
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
                    // **入力欄の見た目は同じでも、確定先が違う**（Issue #131）。
                    // タブのダブルクリックはタブ名、メニューの
                    // 「ペイン名を変更...」はアクティブなペインの名前を変える。
                    // 画面の語と、実際に変わるものを食い違わせない。
                    aria-label={editingTarget === 'tab' ? 'タブ名を編集' : 'ペイン名を編集'}
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
                        startEditing(tab, 'tab');
                      }}
                    >
                      {displayTitle}
                    </span>
                    {allExited && <span className="tab-bar__exit-badge">終了</span>}
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
                {/* **「新しい」を付けない**（Issue #137）。トリガーが
                    `aria-label="新しいタブを開く"`、メニュー自身が
                    `aria-label="新しいタブの種類"` を既に持っているので、
                    項目側で繰り返すと読み上げが「新しいタブの種類、新しいシェル」になる。
                    同じメニューの `Claude` / `Gemini` は裸の名詞なので、
                    ここだけ動詞的だと3択が同格に見えない。
                    **アプリメニュー側（menu.ts の「新しいシェルタブ」）は縮めない。**
                    あちらは直下に「右に分割」（これもシェルを作る）が並ぶので、
                    「タブ」の2文字が分割との区別を担っている。 */}
                シェル
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
