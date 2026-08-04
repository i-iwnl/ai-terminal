import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react';
import type {
  AgentTask,
  AppAction,
  AppConfig,
  PtyExitEvent,
  SessionHistoryEntry,
  SidebarPanel,
} from '@shared/ipc';

/**
 * 読み上げ用のパネル名。**`Sidebar.tsx` の `PANEL_LABEL` と同じ語**
 * （画面に出ている語と読み上げが食い違わないようにする）。
 */
const SIDEBAR_PANEL_LABEL: Record<SidebarPanel, string> = {
  tasks: 'タスク',
  history: '履歴',
  memo: 'メモ',
};
import { DEFAULT_CONFIG } from '@shared/defaults';
import { terminalThemeFrom } from '@shared/theme';
import { resolveTheme } from '@shared/themes';
import Sidebar from './sidebar/Sidebar';
import {
  SIDEBAR_DEFAULT_WIDTH_PX,
  clampSidebarWidth,
  stepSidebarWidth,
} from './sidebar/sidebarWidth';
import TabBar from './tabs/TabBar';
import PaneTreeView from './tabs/PaneTreeView';
import type { TerminalHandle } from './terminal/useTerminal';
import { startPtyStream } from './terminal/ptyStream';
import {
  findPanePath,
  flattenPaneTree,
  getLeaf,
  getNodeAtPath,
  movePaneInDirection,
  nextPane,
  previousPane,
  type PaneCellMetrics,
  type PanePath,
  type SplitDirection,
} from './tabs/paneTree';
import { adjustSplitRatioFor, pathKey } from './tabs/paneSplitter';
import { paneHeaderLabel } from './tabs/paneHeader';
import {
  findPaneByAgentSessionId,
  findTabByAgentSessionId,
  findTabByPtyId,
  nextTabId,
  previousTabId,
  tabDisplayTitle,
  tabLeaf,
  type PaneLocation,
} from './tabs/tabPane';
import { findNextYourTurnTab } from './tabs/tabYourTurn';
import { previousActiveTab, recordActiveTab, type TabHistory } from './tabs/tabHistory';
import CloseTabConfirmDialog from './tabs/CloseTabConfirmDialog';
import { closeTabCopy, summarizeClosingPanes, type CloseTabCopy } from './tabs/closeTabCopy';
import { useTabs } from './tabs/useTabs';
import { isEditableTarget, matchShortcut } from './lib/shortcuts';
import { resolveSharedCwd } from './lib/cwd';
import { sessionDisplayTitle } from './lib/format';
import { dismissNotice, pushNotice, severityForExit, type Notice, type NoticeSeverity } from './lib/notices';
import { subscribeAgentTasks } from './lib/agentTasksStore';

// role="status" の告知テキストを、画面には出さず支援技術にだけ読ませるための見た目。
// styles.css のトークンを経由しない（CLAUDE.md のトークン規約は「色・サイズの値」を
// 本体に直書きしないためのものであり、これは色を持たない構造的な非表示テクニック）。
// 新しいクラスを styles.css に足すと、この PR の対象外である CSS 側の変更が発生するため
// インライン style に留める。
const STATUS_REGION_STYLE: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

/**
 * メニュー項目「分割比を広げる/狭める/50%に戻す」（Issue #56 PR 7）が使う
 * `PaneCellMetrics` を組み立てる。
 *
 * `clampSplitRatio`（paneTree.ts）が求めるのは「分割対象の領域全体」の実寸だが、
 * ドラッグを経由しないこの経路には測る手がかりが `.pane-split` コンテナの DOM
 * 参照（`splitContainerRefs`）しか無い。cwd/フォントは全ペイン共通のため、
 * セル寸法（cellWidthPx/cellHeightPx）はどの leaf の TerminalHandle から
 * 読んでも同じ値になる（representative の leaf から読む）。コンテナの実寸
 * （widthPx/heightPx）だけを、分割の向きに応じてその leaf 自身の値から
 * 実測値へ差し替える。
 */
function buildSplitMetrics(
  dir: SplitDirection,
  containerEl: HTMLDivElement | undefined,
  leafMetrics: PaneCellMetrics | undefined,
): PaneCellMetrics {
  const fallback: PaneCellMetrics = { widthPx: 0, heightPx: 0, cellWidthPx: 0, cellHeightPx: 0 };
  const base = leafMetrics ?? fallback;
  const rect = containerEl?.getBoundingClientRect();
  if (!rect) return base;
  return dir === 'row' ? { ...base, widthPx: rect.width } : { ...base, heightPx: rect.height };
}

export default function App(): ReactElement {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  // Issue #20 PR 11: 単一文字列だった通知を配列 + severity にした。
  // 追加・削除・上限件数の扱いは lib/notices.ts の純粋関数に切り出してある
  // （ここは「いつ何を追加するか」だけを扱う）。
  const [notices, setNotices] = useState<Notice[]>([]);
  // 通知の id は画面内で一意であればよいので、単調増加のカウンタで足りる
  // （crypto.randomUUID 等は不要）。レンダー間で保持するため ref に置く。
  const noticeIdRef = useRef(0);
  const nextNoticeId = useCallback((): string => {
    noticeIdRef.current += 1;
    return `notice-${noticeIdRef.current}`;
  }, []);
  // .app 直下に置く role="status" 用の告知文。PTY の終了は現状 TabBar の
  // 終了バッジ（視覚のみ）でしか分からないため、ここで非視覚的にも拾えるようにする。
  // 空文字のときは何も読み上げられない（初期状態でここが鳴ることはない）。
  //
  // Issue #56 PR 8: 用途が PTY 終了だけでなく「Cmd+W がペインを閉じたのか
  // タブごと閉じたのか」（提案 E'）・「タスク一覧のクリックで対象ペインが
  // 既にアクティブだった」（U4）にも広がったため、変数名を汎用の
  // statusAnnouncement にした（region 自体（.app-status、常に1個）は増やさない）。
  const [statusAnnouncement, setStatusAnnouncement] = useState('');
  const announce = useCallback((message: string) => setStatusAnnouncement(message), []);
  // OS の支援技術（VoiceOver 等）が動いているか。
  // 動いていれば設定に関わらず screenReaderMode を有効にする。
  // 設定の存在を知らないユーザーでもターミナルが読める状態になるのが狙い。
  const [accessibilitySupport, setAccessibilitySupport] = useState(false);
  // サイドバーを畳んでいるか（Cmd+Option+S。Issue #20 K-1）。
  //
  // **状態はここに置く。** Sidebar.tsx の内側に持たせるとキーボード / メニューから
  // トグルできない（Sidebar.tsx は自分の中のタブ切り替え以外の状態を持たない）。
  // 既定は false = 表示したまま。設定（AppConfig）には永続化しない
  // （「一時的に畳む」操作であり、次回起動時にサイドバーが消えている状態から
  // 始まるとタスク一覧・履歴の存在自体に気づけなくなる）。
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // macOS のフルスクリーン中か（Issue #119 周5 / #20 の K-5）。
  //
  // フルスクリーンでは macOS が信号機ボタンを隠すため、その下敷きにしている
  // `.sidebar__drag-region`（36px）を残すと**何も無い帯だけがターミナルの上に
  // 居座る**。Main から流れてくる状態でクラスを切り替え、帯を畳む。
  //
  // **`window.innerHeight` や HTML5 の Fullscreen API では判定できない**
  // （あれは要素の全画面表示で、macOS のウィンドウのフルスクリーンとは別物）。
  const [fullScreen, setFullScreen] = useState(false);
  useEffect(() => {
    return window.api.app.onFullScreenChanged(setFullScreen);
  }, []);
  // サイドバーの幅（Issue #119 周4 / #20 の PR 16）。
  //
  // **折りたたみと違い、こちらは AppConfig に永続化する。** 畳むのは「一時的に
  // どける」操作なので次回起動へ持ち越さないが、幅は「自分が決めた作業環境」で、
  // 畳んで開き直したときに戻らないと毎回やり直しになる。
  //
  // 実際の書き込みは `commitSidebarWidth`（mouseup とメニュー操作のときだけ）。
  // **ドラッグ中は呼ばない。** `configSet` は全ウィンドウへブロードキャストされ、
  // その先で `coerceConfig` が毎回新しい `theme` を組み立てるため、
  // 全ペインの `term.options.theme` 再代入まで連鎖する。
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH_PX);
  // メニュー項目「サイドバーを広げる / 狭める」が、動かした対象へ `.focus()` して
  // フォーカスリングを見せるための参照（PaneSplitterHandle と同じ形）。
  const sidebarResizeHandleRef = useRef<HTMLDivElement | null>(null);
  // サイドバーのパネル切替（Issue #120 周2）。**状態は Sidebar が持つ**
  // （タブ選択・メモの編集途中・履歴の絞り込みはすべて Sidebar の木の中の state で、
  // ここへ持ち上げると畳むたびに失われる）。ここは「切り替えたい」を伝える口だけ持つ。
  const switchSidebarPanelRef = useRef<((panel: SidebarPanel) => void) | null>(null);
  const registerPanelSwitcher = useCallback(
    (switchTo: ((panel: SidebarPanel) => void) | null) => {
      switchSidebarPanelRef.current = switchTo;
    },
    [],
  );
  // ペイン名の変更（Issue #130）。**編集中の下書き文字列は TabBar が持つ**
  // （ここへ持ち上げると、タブの再描画のたびに入力途中の文字が失われる）。
  // 上の registerPanelSwitcher と同じく、ここは「始めたい」を伝える口だけ持つ。
  const startRenameRef = useRef<((tabId: string) => void) | null>(null);
  const registerRenameStarter = useCallback((startRename: ((tabId: string) => void) | null) => {
    startRenameRef.current = startRename;
  }, []);
  // タブを閉じる前の確認（Issue #56 PR 8・design-review.md 提案 E'）。
  // 2つ以上の PTY を一度に閉じるときだけ立つ（requestCloseTab 参照）。
  //
  // **Issue #121 A-3: 文言は「開く時点の内訳」から作って持ち回る。** 表示中に
  // ペインの状態が変わっても、確認した内容と実行する内容がずれないようにするため。
  const [closeConfirmation, setCloseConfirmationState] = useState<{
    tabId: string;
    copy: CloseTabCopy;
  } | null>(null);
  const closeConfirmationRef = useRef(closeConfirmation);
  const setCloseConfirmation = useCallback((value: { tabId: string; copy: CloseTabCopy } | null) => {
    closeConfirmationRef.current = value;
    setCloseConfirmationState(value);
  }, []);

  const showNotice = useCallback(
    (message: string, severity: NoticeSeverity) => {
      setNotices((prev) => pushNotice(prev, { id: nextNoticeId(), message, severity }));
    },
    [nextNoticeId],
  );

  const showError = useCallback((message: string) => showNotice(message, 'error'), [showNotice]);

  const dismissNoticeById = useCallback((id: string) => {
    setNotices((prev) => dismissNotice(prev, id));
  }, []);

  const tabsApi = useTabs(showError);
  const tabsApiRef = useRef(tabsApi);
  tabsApiRef.current = tabsApi;

  // 直前のタブへ戻る（Cmd+E。Issue #20 J）ための、最近アクティブだったタブ id の
  // 履歴。レンダーのたびに作り直す必要が無い（表示に使わない）ため state ではなく
  // ref に持つ。記録ロジック自体（recordActiveTab / previousActiveTab）は
  // tabs/tabHistory.ts の純粋関数で、ここは「いつ記録するか」だけを扱う。
  const tabHistoryRef = useRef<TabHistory>([]);
  useEffect(() => {
    tabHistoryRef.current = recordActiveTab(tabHistoryRef.current, tabsApi.activeTabId);
  }, [tabsApi.activeTabId]);

  // 次の「あなたの番」のタブへジャンプする（Cmd+J。Issue #20 J）ための、タスク一覧の
  // 最新スナップショット。表示（TaskList.tsx）とは別に、ここでも
  // window.api.agents.list を呼び直さないよう共有ハブ（lib/agentTasksStore.ts）を
  // 購読する。ジャンプ計算にしか使わないため state ではなく ref に持つ
  // （タスク一覧が変わるたびに App 全体を再描画する理由が無い）。
  const agentTasksRef = useRef<AgentTask[]>([]);
  useEffect(() => {
    return subscribeAgentTasks((e) => {
      agentTasksRef.current = e.tasks;
    });
  }, []);

  // ペイン（leaf）ごとの TerminalHandle。paneId をキーにする（Issue #56 PR 4）。
  // 分割前は tab.id と leaf の paneId が常に同じ値だったため tab.id キーで
  // 足りていたが、分割後は1タブに複数の leaf（複数の paneId）が同時に存在するため、
  // Cmd+F / Cmd+K 等のグローバル操作が「アクティブなタブの、アクティブなペイン」を
  // 正しく引けるよう paneId キーに変える（design-review.md Q5）。
  const handlesRef = useRef(new Map<string, TerminalHandle>());
  const initializedRef = useRef(false);

  // 分割ノード（`.pane-split`）の DOM コンテナ。paneSplitter.ts の pathKey() で
  // 経路から作ったキーで引く（Issue #56 PR 7）。スプリッタのドラッグ自体は
  // PaneSplitterHandle.tsx がドラッグ開始時に自分の親要素から直接測るため
  // この登録簿を使わないが、**メニュー項目（分割比を広げる/狭める/50%に戻す）は
  // ドラッグ操作を経由しないため、コンテナの実寸をここから引く必要がある**。
  const splitContainerRefsRef = useRef(new Map<string, HTMLDivElement>());
  const registerSplitContainer = useCallback((key: string, el: HTMLDivElement | null) => {
    if (el) splitContainerRefsRef.current.set(key, el);
    else splitContainerRefsRef.current.delete(key);
  }, []);

  // スプリッタ本体（`.pane-splitter`）の DOM。`tabIndex={-1}` なのでプログラム的
  // にしか到達できないが、メニュー項目「分割比を広げる/狭める/50%に戻す」が
  // 比率を動かした**その対象**へ `.focus()` するために引く（レビュー指摘。
  // ペインが3枚以上あるとスプリッタが複数本になり、フォーカスリングが出て
  // 初めてどちらが動いたかが画面から分かる）。
  /**
   * 幅を確定して永続化する。ドラッグの mouseup とメニュー操作からのみ呼ぶ。
   * `clampSidebarWidth` を必ず通す（ドラッグ側でも通しているが、
   * メニュー経路や将来の呼び出し元が範囲外を渡す余地を残さない）。
   */
  const commitSidebarWidth = useCallback((next: number) => {
    const width = clampSidebarWidth(next);
    setSidebarWidth(width);
    // 失敗しても画面上の幅は変わったままにする（次回起動で戻るだけ）。
    void window.api.config.set({ sidebarWidth: width }).catch(() => undefined);
  }, []);

  const splitterRefsRef = useRef(new Map<string, HTMLDivElement>());
  const registerSplitterElement = useCallback((key: string, el: HTMLDivElement | null) => {
    if (el) splitterRefsRef.current.set(key, el);
    else splitterRefsRef.current.delete(key);
  }, []);

  // タブを実際に閉じる（確認が要らない、または確認済みの経路）。
  // 閉じたあと role="status" で結果を告知する（design-review.md 提案 E'）。
  const performCloseTab = useCallback(
    async (tabId: string): Promise<void> => {
      await tabsApiRef.current.closeTab(tabId);
      announce('タブを閉じました');
    },
    [announce],
  );

  /**
   * タブを閉じる唯一の入口（Issue #56 PR 8・design-review.md 提案 E'）。
   * タブバーの x ボタン（TabBar.tsx）とメニュー / キーボード（`close-tab`
   * アクション）の両方がここを通る。
   *
   * **2つ以上の PTY を一度に閉じるときだけ確認する。** 1ペインのタブ
   * （PTY 1本）はそのまま閉じる。`Cmd+Shift+W` を新設していないため、
   * タブバーの x ボタンがマウス経由の抜け穴にならないよう、ここで両方の
   * 入口を合流させる。
   */
  const requestCloseTab = useCallback(
    (tabId: string): void => {
      const tab = tabsApiRef.current.tabs.find((t) => t.id === tabId);
      const leaves = tab ? flattenPaneTree(tab.layout) : [];
      const summary = summarizeClosingPanes(leaves);
      // **1ペインでも、閉じると回収できなくなるものがあるなら確認する**（Issue #121）。
      //
      // tmux でラップされた gemini は、タブを閉じた時点で tmux セッション名を
      // 二度と再現できず、**アプリからは永久に拾い直せない**（src/main/pty/tmux.ts）。
      // 実測でも、タブを閉じたあと tmux セッションと中のプロセスが生き残った。
      // claude は履歴から resume すれば同じセッションに戻れるので、ここでは止めない
      // （タブを閉じるのは1日に何十回もある操作なので、確認は不可逆なものだけに絞る）。
      if (leaves.length >= 2 || summary.persistentOrphaned > 0) {
        setCloseConfirmation({ tabId, copy: closeTabCopy(summary) });
        return;
      }
      void performCloseTab(tabId);
    },
    [performCloseTab, setCloseConfirmation],
  );

  /**
   * タスク一覧のクリック・OS 通知のクリックの両方から呼ぶ、共通のペイン粒度の
   * フォーカス移動（design-review.md U4）。
   *
   * 「タブを前に出す」（`setActiveTabId`）だけでは、対象ペインが今のタブに
   * 既に見えている場合に no-op になり、画面が1pxも動かず壊れて見える。
   * ここでは **タブとペインの両方**を同じ呼び出しで更新したうえで、
   * 「呼び出し前から既にこのペインがアクティブだったか」を見て、
   * 変化が無い場合だけ追加の手がかりを出す。
   *
   * 選んだ手がかり: (1) `handle.focus()` を明示的に呼び直す（`active` prop が
   * 変化しないと TerminalPane.tsx 側の自動フォーカスが発火しないため）、
   * (2) 通知バナー（視覚）+ role="status"（読み上げ）で
   * 「このペインは既に表示されています」を伝える。**「何も起きない」で
   * 終わらせない**ことが要件で、色や位置の変化だけでは色覚特性・スクリーン
   * リーダーの両方に届かないため、語で明示する経路を選んだ。
   */
  const focusPaneLocation = useCallback(
    (location: PaneLocation) => {
      const api = tabsApiRef.current;
      const tab = api.tabs.find((t) => t.id === location.tabId);
      const wasAlreadyActive =
        tab !== undefined && tab.id === api.activeTabId && tab.activePaneId === location.paneId;

      api.setActiveTabId(location.tabId);
      api.setActivePaneInTab(location.tabId, location.paneId);

      if (wasAlreadyActive) {
        handlesRef.current.get(location.paneId)?.focus();
        const leaf = tab ? getLeaf(tab.layout, location.paneId) : undefined;
        const label = leaf ? paneHeaderLabel(leaf) : 'このペイン';
        showNotice(`${label} は既に表示されています`, 'info');
        announce(`${label} は既に表示されています`);
      }
    },
    [announce, showNotice],
  );

  // 設定の読み込み。失敗してもフォールバック値のまま続行する。
  useEffect(() => {
    window.api.config
      .get()
      .then((c) => setConfig(c))
      .catch((err: unknown) => {
        console.warn('[config] 設定の取得に失敗しました。既定値を使用します。', err);
      });
  }, []);

  // 設定ウィンドウは別の Renderer なので、そこでの変更は Main 経由で届く。
  useEffect(() => {
    return window.api.config.onChange(setConfig);
  }, []);

  // ウィンドウタイトルをアクティブなタブに同期する（Issue #119 周5 / #20 の K-10）。
  // `hiddenInset` なので画面上には出ないが、ウィンドウメニュー・Mission Control・
  // App Exposé には出る。**そこだけが「どのウィンドウがどのプロジェクトか」を
  // 見分ける手がかり**になる（3つのリポジトリで同じアプリを開いていると、
  // いまはどれも同じ名前で並ぶ）。
  useEffect(() => {
    const tab = tabsApi.tabs.find((t) => t.id === tabsApi.activeTabId);
    if (!tab) return;
    // **アクティブなペインからではなく、タブの見出しから引く**（Issue #131）。
    // tabLeaf（いま選んでいるペイン）から引いていたため、Cmd+] を押すたびに
    // Mission Control 上のウィンドウ名が書き換わっていた。「どのウィンドウが
    // どのプロジェクトか」を見分けるために入れた層なので、分割中だけその
    // 目的が消えていたことになる。
    window.api.app.setTitle(tabDisplayTitle(tab));
  }, [tabsApi.tabs, tabsApi.activeTabId]);

  // サイドバーの幅は「即座に画面へ反映する state」と「永続化された設定」の2箇所に
  // 存在する（ドラッグ中の追従を Main 経由の往復にすると1フレーム遅れる）。
  // 設定側が動いたら state を合わせる。**初回読み込みもこの経路を通る**
  // （config は FALLBACK_CONFIG で始まり、get() の解決で置き換わる）。
  // commitSidebarWidth は両方を同時に更新するので、この effect は同じ値で
  // 上書きするだけになり、ドラッグ結果を打ち消さない。
  useEffect(() => {
    setSidebarWidth(clampSidebarWidth(config.sidebarWidth));
  }, [config.sidebarWidth]);

  // 実際に適用する配色。**プリセットが選ばれていればそちらが勝つ**が、
  // 未設定・custom・未知の名前では保存済みの `theme`（4色）をそのまま使う
  // （`src/shared/themes.ts` の `resolveTheme` が唯一の正）。
  // この順序で `S21-config.spec.ts`（config.json に theme を直接書いて反映を見る）が
  // 無傷のまま残る。
  const activeTheme = useMemo(
    () => resolveTheme({ themeName: config.themeName, theme: config.theme }),
    [config.themeName, config.theme],
  );

  // クロームの面（サイドバー・行のホバー・浮いた面）を theme.background から
  // 機械的に導出し、CSS 変数へ流し込む（Issue #20 の G「テーマ（方向を逆にする）」）。
  // xterm 側の ITheme は既存の別 effect（useTerminal.ts の options.theme -> term.options）
  // がそのまま TerminalTheme を渡しており、ここでは触らない。CSS からターミナル色を
  // 逆に読む経路は作らない（鉄則2。ここは常に「TS のパレット -> CSS 変数」の一方向）。
  //
  // 既定の theme.background（#1e1e1e）では、この導出結果は styles.css の
  // --surface-0〜3 の既存値と1バイトも変わらない（test/unit/theme.test.ts が固定）。
  //
  // クロームの文字色は静的なままなので、導出した面が明るくなりすぎると
  // 静的な文字色との contrast が壊れる（例: 明るい背景を設定すると surface-3
  // が白に寄り、その上の文字がほぼ読めなくなる）。chromeSafeToApply が false の
  // ときは :root の静的な値へ戻す（「壊れた配色を出すより、追従しないほうがまし」）。
  //
  // **`return` するだけにしてはいけない（Issue #119 周6 で修正）。**
  // 以前は早期 return しており、そのコメントは「:root の静的な値をそのまま生かす」と
  // 書いていたが、それは**一度もインライン適用が起きていない場合にしか成立しない**。
  // 安全なテーマ A -> 危険なテーマ B と切り替えると、A のインライン値が
  // `document.documentElement.style` に残り続け、クロームは A の面のままになる。
  // テーマ切替が設定ウィンドウからのワンクリック操作になった以上、
  // この経路は日常的に通る。**必ず removeProperty で消す。**
  useEffect(() => {
    const root = document.documentElement.style;
    const SURFACE_VARS = ['--surface-0', '--surface-1', '--surface-2', '--surface-3'] as const;
    const { chrome, chromeSafeToApply } = terminalThemeFrom(activeTheme);
    if (!chromeSafeToApply) {
      for (const name of SURFACE_VARS) root.removeProperty(name);
      return;
    }
    root.setProperty('--surface-0', chrome.surface0);
    root.setProperty('--surface-1', chrome.surface1);
    root.setProperty('--surface-2', chrome.surface2);
    root.setProperty('--surface-3', chrome.surface3);
  }, [activeTheme]);

  // 起動時に共有 cwd（アプリを起動したディレクトリ）を解決してから、最初のシェルタブを1枚開く。
  // resolveSharedCwd() は失敗しても home ないし undefined へ確定させて解決するので、
  // ここでの catch は不要（アプリを壊さない設計は lib/cwd.ts 側で担保している）。
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    // PTY 出力のハブは、最初の spawn より前に立てる必要がある
    // （spawn 直後の出力を取りこぼさないため）。
    startPtyStream();
    void resolveSharedCwd().then(() => {
      void tabsApiRef.current.newShellTab();
    });
  }, []);

  // アプリ操作の実行。キーボード（matchShortcut）とメニュー（menu:action）が
  // 同じ AppAction を流してくるので、処理はここ1本に集約する。
  const runAction = useCallback(
    (action: AppAction) => {
      // 確認ダイアログ（提案 E'）を開いている間は他の操作を一切通さない
      // （モーダルの標準的な振る舞い。ダイアログ自体のボタンは onClick で
      // 直接 requestCloseTab の結果を処理するため、この経路を通らない）。
      if (closeConfirmationRef.current) return;

      const api = tabsApiRef.current;
      // Cmd+F / Cmd+K 等は「アクティブなタブの、アクティブなペイン」に向ける
      // （design-review.md Q5）。handlesRef は paneId をキーにしている。
      const activePaneId = (): string | undefined =>
        api.tabs.find((t) => t.id === api.activeTabId)?.activePaneId;

      switch (action.type) {
        case 'new-shell-tab':
          void api.newShellTab();
          break;
        case 'close-tab':
          if (api.activeTabId) requestCloseTab(api.activeTabId);
          break;
        case 'switch-tab': {
          const target = api.tabs[action.index];
          if (target) api.setActiveTabId(target.id);
          break;
        }
        case 'new-claude-tab':
          void api.newAgentTab('claude');
          break;
        case 'new-gemini-tab':
          void api.newAgentTab('gemini');
          break;
        case 'toggle-search': {
          const id = activePaneId();
          if (id) handlesRef.current.get(id)?.toggleSearch();
          break;
        }
        case 'find-next': {
          const id = activePaneId();
          if (id) handlesRef.current.get(id)?.findNext();
          break;
        }
        case 'find-previous': {
          const id = activePaneId();
          if (id) handlesRef.current.get(id)?.findPrevious();
          break;
        }
        case 'clear-terminal': {
          const id = activePaneId();
          if (id) handlesRef.current.get(id)?.clear();
          break;
        }
        case 'toggle-settings':
          // 設定は独立ウィンドウ。既に開いていれば Main 側が前に出す。
          window.api.settings.open();
          break;
        case 'split-pane': {
          const id = activePaneId();
          const metrics = (id && handlesRef.current.get(id)?.getCellMetrics()) || {
            widthPx: 0,
            heightPx: 0,
            cellWidthPx: 0,
            cellHeightPx: 0,
          };
          void api.splitActivePane(action.dir, metrics).then((result) => {
            if (!result.ok) showNotice(result.reason, 'error');
          });
          break;
        }
        case 'close-pane':
          // 結果（ペインを閉じたのか、タブごと閉じたのか）を role="status" で
          // 告知する（design-review.md 提案 E'。視覚以外で区別する手段が
          // 現状ゼロだった）。
          void api.closeActivePane().then((outcome) => {
            announce(outcome.kind === 'tab-closed' ? 'タブを閉じました' : 'ペインを閉じました');
          });
          break;
        case 'toggle-maximize-pane':
          api.toggleMaximizePane();
          break;
        case 'rename-active-pane': {
          // Issue #130。編集の下書き文字列は TabBar が持つので、ここは
          // 「編集を始めたい」を伝えるだけ（Sidebar の registerPanelSwitcher と
          // 同じ形）。
          //
          // **何も起きないまま終わらせない**（Issue #56 U4 の教訓）。
          // タブが1枚も無い起動直後は、押しても画面が1px も動かないので
          // 理由を出す。
          const tabId = api.activeTabId;
          const starter = startRenameRef.current;
          if (tabId === null || starter === null) {
            showNotice('名前を変更できるペインがありません', 'info');
            announce('名前を変更できるペインがありません');
            break;
          }
          starter(tabId);
          break;
        }
        case 'next-pane': {
          const tab = api.tabs.find((t) => t.id === api.activeTabId);
          if (tab) api.setActivePaneInTab(tab.id, nextPane(tab.layout, tab.activePaneId));
          break;
        }
        case 'previous-pane': {
          const tab = api.tabs.find((t) => t.id === api.activeTabId);
          if (tab) api.setActivePaneInTab(tab.id, previousPane(tab.layout, tab.activePaneId));
          break;
        }
        case 'move-pane-focus': {
          const tab = api.tabs.find((t) => t.id === api.activeTabId);
          if (tab) {
            api.setActivePaneInTab(tab.id, movePaneInDirection(tab.layout, tab.activePaneId, action.direction));
          }
          break;
        }
        case 'jump-your-turn-tab': {
          // 状態の意味（あなたの番 = busy 以外）の判定は tabYourTurn.ts が
          // src/shared/agent-status.ts の toTaskState に委ねている（唯一の正）。
          const target = findNextYourTurnTab(
            api.tabs,
            api.activeTabId,
            agentTasksRef.current,
            action.direction,
          );
          if (target) {
            api.setActiveTabId(target);
          } else {
            // 「あなたの番」のタブが1つも無いときに何も起きないまま終わらせない
            // （Issue #56 U4「画面が1pxも動かず壊れて見える」の再発防止）。
            showNotice('あなたの番のタブはありません', 'info');
            announce('あなたの番のタブはありません');
          }
          break;
        }
        case 'last-active-tab': {
          const existing = new Set(api.tabs.map((t) => t.id));
          const target = previousActiveTab(tabHistoryRef.current, existing);
          if (target) {
            api.setActiveTabId(target);
          } else {
            showNotice('直前のタブはありません', 'info');
            announce('直前のタブはありません');
          }
          break;
        }
        case 'toggle-sidebar':
          // 畳むとサイドバー（<nav>）は視覚的にも支援技術からも消える
          // （styles.css の `.sidebar.is-collapsed` が visibility: hidden）。
          // **「何も起きない」で終わらせない**という既存の規律（U4）に従い、
          // どちらへ倒れたかを role="status" で告知する（トグルは押した本人にも
          // 結果が分からない操作になりやすく、サイドバーを見ていない利用者には
          // 画面上の変化が「ターミナルが少し広がった」だけになる）。
          setSidebarCollapsed(!sidebarCollapsed);
          announce(sidebarCollapsed ? 'サイドバーを表示しました' : 'サイドバーを隠しました');
          break;
        case 'adjust-sidebar-width': {
          // メニュー項目「サイドバーを広げる / 狭める / 幅を既定に戻す」。
          // **ドラッグのキーボード代替**（WCAG 2.5.7）。ドラッグを一切経由せず
          // 同じ純粋関数（clampSidebarWidth / stepSidebarWidth）を通す。
          if (sidebarCollapsed) {
            // 畳んでいる状態で幅だけ変えても画面は何も変わらない。
            // 「何も起きない」で終わらせない（U4）。
            showNotice('サイドバーが畳まれています（Cmd+Option+S で表示）', 'info');
            announce('サイドバーが畳まれています');
            break;
          }
          const next =
            action.adjustment === 'reset'
              ? SIDEBAR_DEFAULT_WIDTH_PX
              : stepSidebarWidth(sidebarWidth, action.adjustment);
          commitSidebarWidth(next);
          // 動かした対象へ .focus() してリングを見せる（PaneSplitterHandle と同じ）。
          sidebarResizeHandleRef.current?.focus();
          announce(`サイドバーの幅 ${next} ピクセル`);
          break;
        }
        case 'adjust-font-size': {
          // ターミナルの文字サイズ（Issue #120 周1）。
          //
          // **Electron の zoom（Renderer 全体の拡大率）とは別物。** menu.ts 側で
          // zoom の `role` を外してあるので、同じキーが2系統から発火することはない。
          //
          // 範囲は設定ウィンドウの数値入力（min 6 / max 48）と同じ。
          // 値の正は `coerceConfig` で、そこでも同じ範囲に丸められる。
          const next =
            action.adjustment === 'reset'
              ? DEFAULT_CONFIG.fontSize
              : Math.min(
                  48,
                  Math.max(6, config.fontSize + (action.adjustment === 'increase' ? 1 : -1)),
                );
          if (next === config.fontSize) {
            // 端に達している。**「何も起きない」で終わらせない**（U4）。
            announce(`文字サイズは ${config.fontSize} で、これ以上変えられません`);
            break;
          }
          // **フォントサイズを変えると全ペインが再 fit され pty.resize が走る**
          // （非表示タブも visibility: hidden でレイアウトを持つため
          // clientWidth === 0 のガードを通過する）。連打されうるキーなので、
          // 実際に飛ぶ回数は resizeGate.ts の shouldSendResize（cols/rows が
          // 変わった回だけ通す）が抑える。ここでは間引かない
          // （1回のキー入力で1段階変わることが期待どおりの挙動なので、
          // デバウンスすると「押したのに変わらない」に見える）。
          void window.api.config.set({ fontSize: next }).catch(() => undefined);
          announce(`文字サイズ ${next}`);
          break;
        }
        case 'switch-sidebar-panel': {
          // 畳んでいる間に切り替えても画面は何も変わらないので、まず開く。
          // **「何も起きない」で終わらせない**（U4）。
          if (sidebarCollapsed) setSidebarCollapsed(false);
          switchSidebarPanelRef.current?.(action.panel);
          announce(`${SIDEBAR_PANEL_LABEL[action.panel]} のパネルを表示しました`);
          break;
        }
        case 'next-tab':
          if (api.activeTabId) api.setActiveTabId(nextTabId(api.tabs, api.activeTabId));
          break;
        case 'previous-tab':
          if (api.activeTabId) api.setActiveTabId(previousTabId(api.tabs, api.activeTabId));
          break;
        case 'adjust-split-ratio': {
          // メニュー項目「分割比を広げる/狭める/50%に戻す」（Issue #56 PR 7）。
          // ドラッグの Equivalent 例外の根拠になるため、ドラッグを一切経由せず
          // アクティブなペインを含む「直近の親の分割」だけを操作する。
          const tab = api.tabs.find((t) => t.id === api.activeTabId);
          if (!tab) break;
          const path = findPanePath(tab.layout, tab.activePaneId);
          if (!path || path.length === 0) {
            // アクティブなペインが分割されていない（木がそのまま leaf 1枚）。
            showNotice('アクティブなペインは分割されていません', 'info');
            break;
          }
          const parentPath: PanePath = path.slice(0, -1);
          const childIndex = path[path.length - 1] === 0 ? 0 : 1;
          const splitNode = getNodeAtPath(tab.layout, parentPath);
          if (!splitNode || splitNode.kind !== 'split') break;

          const containerEl = splitContainerRefsRef.current.get(pathKey(parentPath));
          const representativePaneId = flattenPaneTree(splitNode)[0].paneId;
          const leafMetrics = handlesRef.current.get(representativePaneId)?.getCellMetrics();
          const metrics = buildSplitMetrics(splitNode.dir, containerEl, leafMetrics);
          const targetRatio = adjustSplitRatioFor(childIndex, splitNode.ratio, action.adjustment);

          api.updateSplitRatio(tab.id, parentPath, targetRatio, metrics);
          // **動かした対象のスプリッタへ .focus() する**（レビュー指摘）。
          // ペインが3枚以上あるとスプリッタは2本以上になり、フォーカスリング
          // （styles.css `.pane-splitter:focus-visible`）が出て初めて
          // 「どのスプリッタが動いたか」が画面から分かる。`tabIndex={-1}`
          // なので Tab では到達できないが `.focus()` は効く
          // （PaneSplitterHandle.tsx 冒頭コメント参照）。
          splitterRefsRef.current.get(pathKey(parentPath))?.focus();
          break;
        }
      }
    },
    // sidebarCollapsed は toggle-sidebar が「いまどちら側か」を読む必要があるため
    // 依存に含める（runAction は runActionRef 経由でしか呼ばれず、再生成しても
    // keydown / menu:action のリスナは張り直されない）。
    [
      announce,
      commitSidebarWidth,
      config.fontSize,
      requestCloseTab,
      showNotice,
      sidebarCollapsed,
      sidebarWidth,
    ],
  );

  const runActionRef = useRef(runAction);
  runActionRef.current = runAction;

  // グローバルショートカット。capture フェーズで先取りし、xterm に渡る前に処理する。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      // タブ名編集中（.tab-bar__title-input）・履歴タイトル編集中
      // （.history-item__title-input）・contenteditable な要素にフォーカスがある間は
      // 何もせず素通しする（preventDefault も stopPropagation もしない）。
      // ここを見ずに先取りすると、名前を入力している最中の Cmd 系のキーが
      // すべてアプリの操作として走る。たとえば入力欄で Cmd+W を押すと
      // （macOS では入力中でも押しうるキーだが）タブそのものが閉じてしまい、
      // 編集していた対象ごと消える。Issue #56 で Cmd+D が分割表示に割り当たると、
      // 名前の入力中に知らないうちに PTY がもう1本増えるという壊れ方になる（Issue #63）。
      // xterm.js のキー入力用 textarea（.xterm-helper-textarea）はここでいう
      // 「編集中」には含めない。ターミナル操作中は常にこの textarea が
      // フォーカスされているため、含めてしまうとアプリのショートカットが
      // 1つも効かなくなる（isEditableTarget 側のコメント参照）。
      if (isEditableTarget(e.target)) return;

      const action = matchShortcut(e);
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      runActionRef.current(action);
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  // メニューから選ばれた操作。キーは Main 側では登録していない（表示のみ）ので、
  // ここに来るのはメニューを実際にクリックした場合だけ。
  useEffect(() => {
    return window.api.menu.onAction((action) => runActionRef.current(action));
  }, []);

  // OS 通知のクリックから「このセッションを前に出せ」が飛んでくる。
  // タブ単位ではなくペイン単位で解決する（design-review.md U4。対象ペインが
  // 今のタブに既に見えている場合、タブの前面化だけでは画面が1pxも動かない）。
  //
  // Issue #120 C-2（周4）: **対応するペインが無い場合も無言で終わらせない。**
  // 通知は `claude agents --json` のポーリングから作られ、`ownedByApp` で
  // 絞っていない（`scopeAgentsToCwd` の既定は false = マシン全体）。つまり
  // **他のターミナルで起動した claude の完了通知が既定で飛ぶ**。その通知を
  // 押しても、このアプリには対応する leaf が無いので `findPaneByAgentSessionId`
  // が undefined を返す。以前はここで黙って抜けており、ユーザーには
  // 「ウィンドウが前に出ただけで何も起きなかった」ように見えていた。
  //
  // 同じ空振りは「他アプリ起動」限定ではない。tmux 永続化が有効なとき
  // `Cmd+W` でタブを閉じても claude は tmux に残るし、アプリを再起動すれば
  // 以前このアプリが起動したセッションも leaf を持たない。
  //
  // すぐ上の `focusPaneLocation` は「対象ペインが既にアクティブ」のケースに
  // 同じ形の手当て（通知バナー + role="status"）を持っている。**片側にだけ
  // 適用されていた設計方針を、見つからない側にも揃える。**
  // 自動で `--resume` して開くことはしない（issue-24 で「副作用が大きい」と
  // して却下済み。押しただけで新しい PTY が生えるのは行き過ぎ）。
  useEffect(() => {
    return window.api.session.onFocus((agentSessionId) => {
      const location = findPaneByAgentSessionId(tabsApiRef.current.tabs, agentSessionId);
      if (location) {
        focusPaneLocation(location);
        return;
      }
      const message = 'このセッションを開いているタブはありません（サイドバーの「タスク」で確認できます）';
      showNotice(message, 'info');
      announce(message);
    });
  }, [announce, focusPaneLocation, showNotice]);

  // 支援技術の起動状態。初期値を取り、以降は変化を購読する。
  // 取得に失敗しても false のまま続行する（設定からは有効にできる）。
  useEffect(() => {
    window.api.app
      .accessibilitySupport()
      .then((enabled) => setAccessibilitySupport(enabled))
      .catch((err: unknown) => {
        console.warn('[a11y] 支援技術の状態を取得できませんでした。', err);
      });
    return window.api.app.onAccessibilitySupportChanged((enabled) => {
      setAccessibilitySupport(enabled);
    });
  }, []);

  const handleExit = useCallback(
    (event: PtyExitEvent) => {
      tabsApiRef.current.markExited(event.ptyId, {
        exitCode: event.exitCode,
        signal: event.signal,
      });
      // markExited 呼び出し前の tabs から探す（タイトルは終了で変わらないのでどちらでも同じ）。
      // PTY のメタ（title 含む）は leaf に持たせてある（design-review Q4）ので、
      // タブそのものではなく leaf を引いてから読む。
      // **`tabLeaf(tab)`（アクティブな leaf 1枚だけ）ではなく、終了した ptyId に
      // 一致する leaf を木の全体から探す。** 分割後は非アクティブなペインが
      // 終了することもあり、そのまま tabLeaf(tab) を使うと無関係な（アクティブな）
      // leaf のタイトルで通知してしまう。
      const tab = findTabByPtyId(tabsApiRef.current.tabs, event.ptyId);
      if (tab) {
        const exitedLeaf = flattenPaneTree(tab.layout).find((l) => l.ptyId === event.ptyId);
        const title = exitedLeaf?.title ?? tabLeaf(tab).title;
        announce(`${title} が終了しました（コード ${event.exitCode}）`);
        // 通知バナー側は severity で見た目を分ける。正常終了（コード 0・シグナル無し）は
        // 「情報」、異常終了（0 以外のコード・シグナルによる終了）は「エラー」。
        // statusAnnouncement（role="status"、常に1個・a11y 専用）とは別系統で、
        // こちらは晴眼のユーザー向けに可視のバナーとして右上に積む。
        const severity = severityForExit({ exitCode: event.exitCode, signal: event.signal });
        const message =
          severity === 'error'
            ? `${title} が終了しました（コード ${event.exitCode}）`
            : `${title} が終了しました`;
        setNotices((prev) => pushNotice(prev, { id: nextNoticeId(), message, severity }));
      }
    },
    [announce, nextNoticeId],
  );

  // クリック可否の判定は「対応するタブがあるか」のままでよい（design-review.md
  // U4 が直すのは「クリックしたときにどのペインへ向けるか」であって、
  // クリック可能性の判定基準ではない）。
  const canFocusTaskTab = useCallback(
    (agentSessionId: string) => findTabByAgentSessionId(tabsApi.tabs, agentSessionId) !== undefined,
    [tabsApi.tabs],
  );

  // タスク一覧の行クリック。OS 通知クリック（session.onFocus）と同じ
  // ペイン粒度の解決を通す（design-review.md U4）。
  const focusTaskTab = useCallback(
    (agentSessionId: string) => {
      const location = findPaneByAgentSessionId(tabsApiRef.current.tabs, agentSessionId);
      if (location) focusPaneLocation(location);
    },
    [focusPaneLocation],
  );

  // タスク一覧の空状態にある「起動」ボタン（Issue #20 I-3）。Cmd+Shift+C /
  // メニューの「新しい Claude タブ」と同じ操作を、初見ユーザーが説明書を読まずに
  // 踏める唯一の画面上の導線にする。
  const launchClaude = useCallback(() => {
    void tabsApiRef.current.newAgentTab('claude');
  }, []);

  const resumeHistory = useCallback((entry: SessionHistoryEntry) => {
    const title = sessionDisplayTitle(entry);
    if (entry.provider === 'claude') {
      void tabsApiRef.current.newAgentTab('claude', {
        resumeSessionId: entry.sessionId,
        cwd: entry.cwd,
        title,
      });
    } else {
      void tabsApiRef.current.newAgentTab('gemini', {
        geminiResumeTarget: entry.sessionId,
        cwd: entry.cwd,
        title,
      });
    }
  }, []);

  // アクティブなタブのペイン数を Main へ知らせる。「タブを閉じる（N ペイン）」の
  // ラベル（src/main/menu.ts）を動かすためだけの一方向通知（design-review.md
  // 「確定している仕様」）。tabs か activeTabId が変わるたびに送るので、
  // タブ切り替え・分割・ペインを閉じるのいずれでも最新化される。
  useEffect(() => {
    const activeTab = tabsApi.tabs.find((t) => t.id === tabsApi.activeTabId);
    const paneCount = activeTab ? flattenPaneTree(activeTab.layout).length : 1;
    window.api.menu.reportPaneCount(paneCount);
  }, [tabsApi.tabs, tabsApi.activeTabId]);

  return (
    <div className={`app${fullScreen ? ' is-fullscreen' : ''}`}>
      {/* 見出し階層の頂点（Issue #119 周3）。本体ウィンドウには <h2> が
          フラットに並ぶだけで <h1> が1つも無く、VoiceOver のローターで
          見出しを辿っても階層が読めなかった。視覚的には出さない
          （タイトルバーは titleBarStyle: 'hiddenInset' で見えないため、
          画面に文字を増やす理由が無い）。 */}
      <h1 className="visually-hidden">ai-terminal</h1>
      <Sidebar
        collapsed={sidebarCollapsed}
        onFocusTaskTab={focusTaskTab}
        canFocusTaskTab={canFocusTaskTab}
        onResumeHistory={resumeHistory}
        onLaunchClaude={launchClaude}
        scopeAgentsToCwd={config.scopeAgentsToCwd}
        width={sidebarWidth}
        onCommitWidth={commitSidebarWidth}
        registerResizeHandleRef={(el) => {
          sidebarResizeHandleRef.current = el;
        }}
        registerPanelSwitcher={registerPanelSwitcher}
      />
      <main className="main">
        <TabBar
          sidebarCollapsed={sidebarCollapsed}
          tabs={tabsApi.tabs}
          activeTabId={tabsApi.activeTabId}
          onSelect={tabsApi.setActiveTabId}
          onClose={requestCloseTab}
          onNewShell={() => void tabsApi.newShellTab()}
          onNewClaude={() => void tabsApi.newAgentTab('claude')}
          onNewGemini={() => void tabsApi.newAgentTab('gemini')}
          onRenameTab={tabsApi.renameTab}
          onRenamePane={tabsApi.renamePane}
          registerRenameStarter={registerRenameStarter}
          onOpenSettings={() => window.api.settings.open()}
        />
        <div className="terminal-stack">
          {tabsApi.tabs.map((tab) => (
            // タブ1枚ぶんのペインの木を再帰的に描画する（Issue #56 PR 4。
            // 分割していないタブは leaf 1枚 = 従来どおり .terminal-pane が
            // 1つ、.terminal-stack を絶対配置で覆う。分割していれば
            // .pane-split が同じ役目を持つ。PaneTreeView.tsx 参照）。
            <PaneTreeView
              key={tab.id}
              node={tab.layout}
              tabId={tab.id}
              activePaneId={tab.activePaneId}
              tabVisible={tab.id === tabsApi.activeTabId}
              // 最大化中（Issue #56 PR 8）は「今アクティブなペイン」がそのまま
              // 最大化対象になる（tab.maximized は真偽値。useTabs.ts 参照）。
              maximizedPaneId={tab.maximized ? tab.activePaneId : undefined}
              fontFamily={config.fontFamily}
              fontSize={config.fontSize}
              theme={activeTheme}
              // screenReaderMode を有効にしてよいかの設定側の判断（アクティブな
              // タブ・アクティブなペインへの絞り込みは PaneTreeView 側が担う）。
              // xterm は screenReaderMode 有効時に aria-live="assertive" の live
              // region を生成する（AccessibilityManager）。assertive は読み上げを
              // 割り込んで中断するため、支援技術に露出している live region は
              // 常に1個でなければならない（2個以上が同時に喋ると、片方の読み上げが
              // もう片方に潰される）。分割（Issue #56）で同一タブ内の複数ペインが
              // 同時に visible になっても、PaneTreeView がアクティブな1ペインにしか
              // true を渡さないため、この不変条件は保たれる（S37 が固定）。
              screenReaderModeEnabled={config.screenReaderMode || accessibilitySupport}
              onExit={handleExit}
              onActivate={(paneId) => tabsApiRef.current.setActivePaneInTab(tab.id, paneId)}
              registerHandle={(paneId, handle) => {
                if (handle) handlesRef.current.set(paneId, handle);
                else handlesRef.current.delete(paneId);
              }}
              registerSplitRef={registerSplitContainer}
              registerSplitterRef={registerSplitterElement}
              // スプリッタのドラッグが mouseup で確定したときの唯一の入口
              // （Issue #56 PR 7）。ドラッグ中に何度も呼ばれることはなく、
              // ここで呼ぶのは確定した1回だけ（PaneSplitterHandle.tsx 参照）。
              onRatioCommit={(path, ratio) => {
                const splitNode = getNodeAtPath(tab.layout, path);
                if (!splitNode || splitNode.kind !== 'split') return;
                const containerEl = splitContainerRefsRef.current.get(pathKey(path));
                const representativePaneId = flattenPaneTree(splitNode)[0].paneId;
                const leafMetrics = handlesRef.current.get(representativePaneId)?.getCellMetrics();
                const metrics = buildSplitMetrics(splitNode.dir, containerEl, leafMetrics);
                tabsApiRef.current.updateSplitRatio(tab.id, path, ratio, metrics);
              }}
            />
          ))}
          {/* Issue #20 I-3: タブ0件はユーザーに見せるべき空状態ではない。
              useTabs.ts の closeTab は最後の1枚を閉じた瞬間に自動でシェルタブを
              再生成し（起動直後の初回スポーンも resolveSharedCwd 完了後に即座に走る）、
              tabs.length === 0 は「その再生成が完了するまでの一瞬のローディング」
              にしかならない。ここで「タブがありません」と出すと、実際には
              一瞬で消える一時状態を恒久的な空状態であるかのように誤解させる。

              S08 close-tab が「自動再生成後に空状態の文言が出ていないこと」を
              検証している。**Issue #120 D-1（周5）で、その assert が
              空回りしていたことが分かって直した** — 廃止済みのクラス
              `.terminal-stack__empty` の toHaveCount(0) を見ており、
              存在しないセレクタが0件なのは当たり前で、空状態を復活させても
              赤くならなかった。今は文言そのものを見ている。 */}
        </div>
        {notices.length > 0 && (
          // 通知1件ごとに role="alert" を付けると、複数件が同時に現れたとき
          // assertive な live region が2つ以上になり、支援技術の読み上げが互いを
          // 潰し合う（design-review.md 0-4 の既知の失敗）。そこで何件・何 severity
          // 積んでいても、露出する live region はこの入れ物1個だけにする
          // （中身だけが増減し、要素自体は増えない）。
          // role はエラーが1件でもあれば "alert"（assertive。中断してでも伝える）、
          // 情報しか無ければ "status"（polite。読み上げの順番待ちに入るだけで、
          // 既存の発話を中断しない）に出し分ける。後者のときに他の polite な
          // live region（.app-status、S48 が「常に1個」を固定）と2つ同時に
          // 存在することはあるが、polite 同士は互いを中断しないため
          // S37/S48 が守る「assertive な live region は常に1個」という
          // 不変条件は壊さない。
          <div
            className="notice-list"
            role={notices.some((n) => n.severity === 'error') ? 'alert' : 'status'}
          >
            {notices.map((n) => (
              <div key={n.id} className={`notice-banner notice-banner--${n.severity}`}>
                <span className="notice-banner__icon" aria-hidden="true">
                  {n.severity === 'error' ? '!' : 'i'}
                </span>
                <span className="notice-banner__label">
                  {n.severity === 'error' ? 'エラー' : '情報'}
                </span>
                <span className="notice-banner__message">{n.message}</span>
                <button
                  onClick={() => dismissNoticeById(n.id)}
                  aria-label="閉じる"
                  title="閉じる"
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}
      </main>
      {/*
        .app 直下に置く唯一の role="status" live region（0-c）。
        現状の中身は PTY 終了の告知だけ（handleExit 参照）。0-a（S37）が固定した
        「支援技術に露出している live region は常に1個」という不変条件は、
        xterm 内部の .xterm-accessibility（aria-live="assertive"、アクティブなタブ1個分だけ
        生成される）を指すもので、ここは対象外の別系統。role="status" の暗黙 aria-live は
        "polite" なので、xterm 側が assertive で読み上げ中でもそれを割り込んで
        中断することはなく、キューの後ろに回るだけ（design-review.md 0-4 が問題視した
        「assertive 同士が互いの発話を潰す」事象とは別種）。
        分割表示（Issue #56）でペインが複数になっても、この告知は
        タブ単位のまま1個で足りる（ペイン単位の告知は将来の PR の対象）。
      */}
      <div className="app-status" role="status" style={STATUS_REGION_STYLE}>
        {statusAnnouncement}
      </div>
      {closeConfirmation && (
        // 2つ以上の PTY を一度に閉じるときの確認（Issue #56 PR 8・design-review.md
        // 提案 E'）。position: fixed のオーバーレイなので DOM 上の位置は問わない。
        <CloseTabConfirmDialog
          copy={closeConfirmation.copy}
          onCancel={() => setCloseConfirmation(null)}
          onConfirm={() => {
            const { tabId } = closeConfirmation;
            setCloseConfirmation(null);
            void performCloseTab(tabId);
          }}
        />
      )}
    </div>
  );
}
