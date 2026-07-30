import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import type { AppAction, AppConfig, PtyExitEvent, SessionHistoryEntry } from '@shared/ipc';
import { DEFAULT_CONFIG } from '@shared/defaults';
import Sidebar from './sidebar/Sidebar';
import TabBar from './tabs/TabBar';
import TerminalPane from './terminal/TerminalPane';
import type { TerminalHandle } from './terminal/useTerminal';
import { startPtyStream } from './terminal/ptyStream';
import { useTabs } from './tabs/useTabs';
import { isEditableTarget, matchShortcut } from './lib/shortcuts';
import { resolveSharedCwd } from './lib/cwd';
import { sessionDisplayTitle } from './lib/format';

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

export default function App(): ReactElement {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [notice, setNotice] = useState<string | null>(null);
  // .app 直下に置く role="status" 用の告知文。PTY の終了は現状 TabBar の
  // 終了バッジ（視覚のみ）でしか分からないため、ここで非視覚的にも拾えるようにする。
  // 空文字のときは何も読み上げられない（初期状態でここが鳴ることはない）。
  const [exitAnnouncement, setExitAnnouncement] = useState('');
  // OS の支援技術（VoiceOver 等）が動いているか。
  // 動いていれば設定に関わらず screenReaderMode を有効にする。
  // 設定の存在を知らないユーザーでもターミナルが読める状態になるのが狙い。
  const [accessibilitySupport, setAccessibilitySupport] = useState(false);

  const showError = useCallback((message: string) => {
    setNotice(message);
  }, []);

  const tabsApi = useTabs(showError);
  const tabsApiRef = useRef(tabsApi);
  tabsApiRef.current = tabsApi;

  const handlesRef = useRef(new Map<string, TerminalHandle>());
  const initializedRef = useRef(false);

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
  const runAction = useCallback((action: AppAction) => {
    const api = tabsApiRef.current;
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
        const id = api.activeTabId;
        if (id) handlesRef.current.get(id)?.toggleSearch();
        break;
      }
      case 'find-next': {
        const id = api.activeTabId;
        if (id) handlesRef.current.get(id)?.findNext();
        break;
      }
      case 'find-previous': {
        const id = api.activeTabId;
        if (id) handlesRef.current.get(id)?.findPrevious();
        break;
      }
      case 'clear-terminal': {
        const id = api.activeTabId;
        if (id) handlesRef.current.get(id)?.clear();
        break;
      }
      case 'toggle-settings':
        // 設定は独立ウィンドウ。既に開いていれば Main 側が前に出す。
        window.api.settings.open();
        break;
    }
  }, []);

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
      const tab = tabsApiRef.current.tabs.find((t) => t.agentSessionId === agentSessionId);
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

  const handleExit = useCallback((event: PtyExitEvent) => {
    tabsApiRef.current.markExited(event.ptyId, { exitCode: event.exitCode, signal: event.signal });
    // markExited 呼び出し前の tabs から探す（タイトルは終了で変わらないのでどちらでも同じ）。
    const tab = tabsApiRef.current.tabs.find((t) => t.ptyId === event.ptyId);
    if (tab) {
      setExitAnnouncement(
        `${tab.title} が終了しました（コード ${event.exitCode}）`,
      );
    }
  }, []);

  const canFocusTaskTab = useCallback(
    (agentSessionId: string) => tabsApi.tabs.some((t) => t.agentSessionId === agentSessionId),
    [tabsApi.tabs],
  );

  const focusTaskTab = useCallback((agentSessionId: string) => {
    const tab = tabsApiRef.current.tabs.find((t) => t.agentSessionId === agentSessionId);
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
            <TerminalPane
              key={tab.id}
              ref={(handle) => {
                if (handle) handlesRef.current.set(tab.id, handle);
                else handlesRef.current.delete(tab.id);
              }}
              ptyId={tab.ptyId}
              active={tab.id === tabsApi.activeTabId}
              fontFamily={config.fontFamily}
              fontSize={config.fontSize}
              theme={config.theme}
              // screenReaderMode はアクティブなタブにだけ渡す。
              // xterm は screenReaderMode 有効時に aria-live="assertive" の live region を
              // 生成する（AccessibilityManager）。assertive は読み上げを割り込んで中断するため、
              // 支援技術に露出している live region は常に1個でなければならない
              // （2個以上が同時に喋ると、片方の読み上げがもう片方に潰される）。
              // 今日は非アクティブなペインが visibility: hidden で a11y ツリーからも
              // 除去されるため、全タブに渡しても結果的に露出は1個に収まる（実質 no-op）。
              // だが Issue #56（分割表示）が入ると同一タブ内の複数ペインが同時に visible に
              // なり、この遮断が効かなくなる。そのときに複数ペインが同時に
              // screenReaderMode: true を持たないよう、ここで不変条件として明示しておく。
              screenReaderMode={tab.id === tabsApi.activeTabId && (config.screenReaderMode || accessibilitySupport)}
              onExit={handleExit}
            />
          ))}
          {tabsApi.tabs.length === 0 && <div className="terminal-stack__empty">タブがありません</div>}
        </div>
        {notice && (
          <div className="notice-banner" role="alert">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} aria-label="閉じる" title="閉じる">
              x
            </button>
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
