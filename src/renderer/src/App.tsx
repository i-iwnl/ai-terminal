import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { AppConfig, PtyExitEvent, SessionHistoryEntry } from '@shared/ipc';
import Sidebar from './sidebar/Sidebar';
import TabBar from './tabs/TabBar';
import TerminalPane from './terminal/TerminalPane';
import type { TerminalHandle } from './terminal/useTerminal';
import { useTabs } from './tabs/useTabs';
import { matchShortcut } from './lib/shortcuts';
import { resolveSharedCwd } from './lib/cwd';

// window.api.config.get() が失敗した場合の既定値。
// src/main/config.ts の DEFAULT_CONFIG と揃えてある。
const FALLBACK_CONFIG: AppConfig = {
  shell: undefined,
  fontFamily: 'Menlo, "SF Mono", monospace',
  fontSize: 13,
  pollIntervalMs: 3000,
  useTmux: true,
  notifyOnIdle: true,
  notifySound: true,
  scopeAgentsToCwd: false,
  theme: {
    background: '#1e1e1e',
    foreground: '#d4d4d4',
    cursor: '#d4d4d4',
    selectionBackground: '#264f78',
  },
};

export default function App(): ReactElement {
  const [config, setConfig] = useState<AppConfig>(FALLBACK_CONFIG);
  const [notice, setNotice] = useState<string | null>(null);

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

  // 起動時に共有 cwd（アプリを起動したディレクトリ）を解決してから、最初のシェルタブを1枚開く。
  // resolveSharedCwd() は失敗しても home ないし undefined へ確定させて解決するので、
  // ここでの catch は不要（アプリを壊さない設計は lib/cwd.ts 側で担保している）。
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    void resolveSharedCwd().then(() => {
      void tabsApiRef.current.newShellTab();
    });
  }, []);

  // グローバルショートカット。capture フェーズで先取りし、xterm に渡る前に処理する。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const action = matchShortcut(e);
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();

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
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  const handleExit = useCallback((event: PtyExitEvent) => {
    tabsApiRef.current.markExited(event.ptyId, { exitCode: event.exitCode, signal: event.signal });
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
    if (entry.provider === 'claude') {
      void tabsApiRef.current.newAgentTab('claude', {
        resumeSessionId: entry.sessionId,
        cwd: entry.cwd,
      });
    } else {
      void tabsApiRef.current.newAgentTab('gemini', {
        geminiResumeTarget: entry.sessionId,
        cwd: entry.cwd,
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
      <div className="main">
        <TabBar
          tabs={tabsApi.tabs}
          activeTabId={tabsApi.activeTabId}
          onSelect={tabsApi.setActiveTabId}
          onClose={(id) => void tabsApi.closeTab(id)}
          onNewShell={() => void tabsApi.newShellTab()}
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
              onExit={handleExit}
            />
          ))}
          {tabsApi.tabs.length === 0 && <div className="terminal-stack__empty">タブがありません</div>}
        </div>
        {notice && (
          <div className="notice-banner">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} aria-label="閉じる" title="閉じる">
              x
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
