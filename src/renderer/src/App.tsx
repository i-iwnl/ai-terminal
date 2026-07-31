import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import type { AppAction, AppConfig, PtyExitEvent, SessionHistoryEntry } from '@shared/ipc';
import { DEFAULT_CONFIG } from '@shared/defaults';
import { terminalThemeFrom } from '@shared/theme';
import Sidebar from './sidebar/Sidebar';
import TabBar from './tabs/TabBar';
import PaneTreeView from './tabs/PaneTreeView';
import type { TerminalHandle } from './terminal/useTerminal';
import { startPtyStream } from './terminal/ptyStream';
import {
  findPanePath,
  flattenPaneTree,
  getNodeAtPath,
  type PaneCellMetrics,
  type PanePath,
  type SplitDirection,
} from './tabs/paneTree';
import { adjustSplitRatioFor, pathKey } from './tabs/paneSplitter';
import { findTabByAgentSessionId, findTabByPtyId, tabLeaf } from './tabs/tabPane';
import { useTabs } from './tabs/useTabs';
import { isEditableTarget, matchShortcut } from './lib/shortcuts';
import { resolveSharedCwd } from './lib/cwd';
import { sessionDisplayTitle } from './lib/format';
import { dismissNotice, pushNotice, severityForExit, type Notice, type NoticeSeverity } from './lib/notices';

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
  const [exitAnnouncement, setExitAnnouncement] = useState('');
  // OS の支援技術（VoiceOver 等）が動いているか。
  // 動いていれば設定に関わらず screenReaderMode を有効にする。
  // 設定の存在を知らないユーザーでもターミナルが読める状態になるのが狙い。
  const [accessibilitySupport, setAccessibilitySupport] = useState(false);

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
  const splitterRefsRef = useRef(new Map<string, HTMLDivElement>());
  const registerSplitterElement = useCallback((key: string, el: HTMLDivElement | null) => {
    if (el) splitterRefsRef.current.set(key, el);
    else splitterRefsRef.current.delete(key);
  }, []);

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
  // ときは setProperty を呼ばず、:root の静的な値をそのまま生かす
  // （「壊れた配色を出すより、追従しないほうがまし」。既知の制限として記録済み。
  // 文字色まで含めたパレット化は PR 18 の範囲）。
  useEffect(() => {
    const { chrome, chromeSafeToApply } = terminalThemeFrom(config.theme);
    if (!chromeSafeToApply) return;
    const root = document.documentElement.style;
    root.setProperty('--surface-0', chrome.surface0);
    root.setProperty('--surface-1', chrome.surface1);
    root.setProperty('--surface-2', chrome.surface2);
    root.setProperty('--surface-3', chrome.surface3);
  }, [config.theme]);

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
          if (api.activeTabId) void api.closeTab(api.activeTabId);
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
          void api.closeActivePane();
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
    [showNotice],
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

  // OS 通知のクリックから「このセッションのタブを前に出せ」が飛んでくる。
  // 対応するタブが無い場合は何もしない（ウィンドウの前面化は Main 側で済んでいる）。
  useEffect(() => {
    return window.api.session.onFocus((agentSessionId) => {
      const tab = findTabByAgentSessionId(tabsApiRef.current.tabs, agentSessionId);
      if (tab) tabsApiRef.current.setActiveTabId(tab.id);
    });
  }, []);

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
        setExitAnnouncement(`${title} が終了しました（コード ${event.exitCode}）`);
        // 通知バナー側は severity で見た目を分ける。正常終了（コード 0・シグナル無し）は
        // 「情報」、異常終了（0 以外のコード・シグナルによる終了）は「エラー」。
        // exitAnnouncement（role="status"、常に1個・a11y 専用）とは別系統で、
        // こちらは晴眼のユーザー向けに可視のバナーとして右上に積む。
        const severity = severityForExit({ exitCode: event.exitCode, signal: event.signal });
        const message =
          severity === 'error'
            ? `${title} が終了しました（コード ${event.exitCode}）`
            : `${title} が終了しました`;
        setNotices((prev) => pushNotice(prev, { id: nextNoticeId(), message, severity }));
      }
    },
    [nextNoticeId],
  );

  const canFocusTaskTab = useCallback(
    (agentSessionId: string) => findTabByAgentSessionId(tabsApi.tabs, agentSessionId) !== undefined,
    [tabsApi.tabs],
  );

  const focusTaskTab = useCallback((agentSessionId: string) => {
    const tab = findTabByAgentSessionId(tabsApiRef.current.tabs, agentSessionId);
    if (tab) tabsApiRef.current.setActiveTabId(tab.id);
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
    <div className="app">
      <Sidebar
        onFocusTaskTab={focusTaskTab}
        canFocusTaskTab={canFocusTaskTab}
        onResumeHistory={resumeHistory}
      />
      <main className="main">
        <TabBar
          tabs={tabsApi.tabs}
          activeTabId={tabsApi.activeTabId}
          onSelect={tabsApi.setActiveTabId}
          onClose={(id) => void tabsApi.closeTab(id)}
          onNewShell={() => void tabsApi.newShellTab()}
          onRename={tabsApi.renameTab}
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
              fontFamily={config.fontFamily}
              fontSize={config.fontSize}
              theme={config.theme}
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
          {tabsApi.tabs.length === 0 && <div className="terminal-stack__empty">タブがありません</div>}
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
        {exitAnnouncement}
      </div>
    </div>
  );
}
