// ターミナルタブの状態管理（生成・切り替え・終了）。
// xterm.js インスタンス自体は terminal/TerminalPane.tsx 側が持つ。ここではタブのメタデータと
// PTY の起動・終了だけを扱う。

import { useCallback, useRef, useState } from 'react';
import type { PtyKind, SpawnPtyRequest } from '@shared/ipc';
import { getSharedCwd } from '../lib/cwd';

export interface TabState {
  /** タブ / PTY を一意に識別する ID（ptyId をそのまま使う） */
  id: string;
  ptyId: string;
  kind: PtyKind;
  title: string;
  /** claude を起動した場合の --session-id。タスク一覧との突き合わせに使う */
  agentSessionId?: string;
  cwd?: string;
  createdAt: number;
  exit?: { exitCode: number; signal?: number };
}

export interface SpawnOpts {
  resumeSessionId?: string;
  geminiResumeTarget?: string;
  cwd?: string;
}

export interface UseTabsResult {
  tabs: TabState[];
  activeTabId: string | null;
  setActiveTabId: (id: string) => void;
  newShellTab: () => Promise<void>;
  newAgentTab: (kind: 'claude' | 'gemini', opts?: SpawnOpts) => Promise<void>;
  closeTab: (id: string) => Promise<void>;
  markExited: (ptyId: string, exit: { exitCode: number; signal?: number }) => void;
}

// 初期の桁数/行数。マウント後すぐに fitAddon.fit() で実サイズに補正される。
const INITIAL_COLS = 80;
const INITIAL_ROWS = 24;

function describeSpawnError(err: unknown, kind: PtyKind): string {
  const message = err instanceof Error ? err.message : String(err);
  if (kind !== 'shell' && /not found|enoent|no such file/i.test(message)) {
    return `${kind} コマンドが見つかりません。PATH を確認してください。`;
  }
  return `起動に失敗しました: ${message}`;
}

export function useTabs(onError: (message: string) => void): UseTabsResult {
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [activeTabId, setActiveTabIdState] = useState<string | null>(null);

  const tabsRef = useRef<TabState[]>(tabs);
  tabsRef.current = tabs;
  const activeTabIdRef = useRef<string | null>(activeTabId);
  activeTabIdRef.current = activeTabId;

  const setActiveTabId = useCallback((id: string) => {
    setActiveTabIdState(id);
  }, []);

  const spawn = useCallback(
    async (kind: PtyKind, title: string, opts?: SpawnOpts): Promise<void> => {
      const cwd = opts?.cwd ?? getSharedCwd();
      const req: SpawnPtyRequest = {
        kind,
        cwd,
        cols: INITIAL_COLS,
        rows: INITIAL_ROWS,
        resumeSessionId: opts?.resumeSessionId,
        geminiResumeTarget: opts?.geminiResumeTarget,
      };
      try {
        const result = await window.api.pty.spawn(req);
        const tab: TabState = {
          id: result.ptyId,
          ptyId: result.ptyId,
          kind,
          title,
          agentSessionId: result.agentSessionId,
          cwd,
          createdAt: Date.now(),
        };
        setTabs((prev) => [...prev, tab]);
        setActiveTabIdState(result.ptyId);
      } catch (err) {
        onError(describeSpawnError(err, kind));
      }
    },
    [onError],
  );

  const newShellTab = useCallback(() => spawn('shell', 'zsh'), [spawn]);

  const newAgentTab = useCallback(
    (kind: 'claude' | 'gemini', opts?: SpawnOpts): Promise<void> => {
      const isResume = Boolean(opts?.resumeSessionId ?? opts?.geminiResumeTarget);
      const title = isResume ? `${kind} (再開)` : kind;
      // 現在アクティブなタブの cwd を引き継ぐ。MVP では全タブ共通の cwd だが、
      // 将来タブごとに cwd を追跡するようになっても自然に動くようにしてある。
      const currentCwd = tabsRef.current.find((t) => t.id === activeTabIdRef.current)?.cwd;
      return spawn(kind, title, { ...opts, cwd: opts?.cwd ?? currentCwd ?? getSharedCwd() });
    },
    [spawn],
  );

  const closeTab = useCallback(
    async (id: string): Promise<void> => {
      const tab = tabsRef.current.find((t) => t.id === id);
      if (!tab) return;
      try {
        await window.api.pty.kill(tab.ptyId);
      } catch (err) {
        // 既に終了している場合などは失敗しうる。タブは閉じてよいので無視する。
        console.warn('[tabs] PTY の終了に失敗しました', err);
      }

      const remaining = tabsRef.current.filter((t) => t.id !== id);
      setTabs(remaining);

      if (activeTabIdRef.current === id) {
        const next = remaining[remaining.length - 1];
        setActiveTabIdState(next ? next.id : null);
      }

      if (remaining.length === 0) {
        // 最後の1枚を閉じた場合は、新しいシェルタブを自動で開く。
        void spawn('shell', 'zsh');
      }
    },
    [spawn],
  );

  const markExited = useCallback((ptyId: string, exit: { exitCode: number; signal?: number }) => {
    setTabs((prev) => prev.map((t) => (t.ptyId === ptyId ? { ...t, exit } : t)));
  }, []);

  return { tabs, activeTabId, setActiveTabId, newShellTab, newAgentTab, closeTab, markExited };
}
