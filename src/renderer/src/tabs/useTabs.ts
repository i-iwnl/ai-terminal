// ターミナルタブの状態管理（生成・切り替え・終了）。
// xterm.js インスタンス自体は terminal/TerminalPane.tsx 側が持つ。ここではタブのメタデータと
// PTY の起動・終了だけを扱う。

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PtyKind, SpawnPtyRequest } from '@shared/ipc';
import { getSharedCwd, setSharedCwd } from '../lib/cwd';
import { forgetPty } from '../terminal/ptyStream';

// シェルの cd への追従ポーリング間隔。
// エージェントタブ（claude / gemini）は自分から cd しないので対象外。
// tmux でラップして起動している場合、lsof が返すのは tmux クライアント側の cwd で
// シェルの実際の作業ディレクトリとは無関係になるため、これも対象外にする理由の一つ。
const CWD_POLL_INTERVAL_MS = 2_000;

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
  /** 指定があればタブタイトルにそのまま使う（履歴からの再開で、履歴一覧の表示名を引き継ぐ用途）。 */
  title?: string;
}

export interface UseTabsResult {
  tabs: TabState[];
  activeTabId: string | null;
  setActiveTabId: (id: string) => void;
  newShellTab: () => Promise<void>;
  newAgentTab: (kind: 'claude' | 'gemini', opts?: SpawnOpts) => Promise<void>;
  closeTab: (id: string) => Promise<void>;
  markExited: (ptyId: string, exit: { exitCode: number; signal?: number }) => void;
  renameTab: (id: string, title: string) => void;
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

  // PTY の実プロセスに cwd を問い合わせて、変化していればそのタブの cwd を更新する。
  // reject した場合・cwd が取得できなかった場合は何もしない（直前の値を維持する）。
  // 2秒間隔のポーリングから呼ばれるため、console.warn 等のログは出さない
  // （出すとログがすぐ埋まる。lsof が一時的に失敗するのは珍しくない）。
  const refreshTabCwd = useCallback((ptyId: string): void => {
    window.api.pty
      .cwd(ptyId)
      .then((result) => {
        if (!result.cwd) return;
        setTabs((prev) => {
          const tab = prev.find((t) => t.ptyId === ptyId);
          if (!tab || tab.cwd === result.cwd) return prev;
          return prev.map((t) => (t.ptyId === ptyId ? { ...t, cwd: result.cwd } : t));
        });
        // このタブがまだアクティブなら、サイドバーへもそのまま反映する。
        if (activeTabIdRef.current === ptyId) {
          setSharedCwd(result.cwd);
        }
      })
      .catch(() => {
        // 何もしない（直前の値を維持する）。
      });
  }, []);

  // アクティブなタブが切り替わったら、待たずにそのタブの cwd を共有値へ反映する
  // （サイドバーは常に「いま見ているタブの文脈」を映すのが狙い）。
  // シェルタブなら、記録済みの値だけでなく実プロセスへ問い合わせ直して最新化し、
  // 以降は cd への追従のためポーリングする。対象はアクティブなタブ1枚だけ。
  useEffect(() => {
    const tab = tabsRef.current.find((t) => t.id === activeTabId);
    if (!tab) return;
    setSharedCwd(tab.cwd);
    if (tab.kind !== 'shell') return;
    const ptyId = tab.ptyId;
    refreshTabCwd(ptyId);
    const timer = window.setInterval(() => {
      refreshTabCwd(ptyId);
    }, CWD_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [activeTabId, refreshTabCwd]);

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
    async (kind: 'claude' | 'gemini', opts?: SpawnOpts): Promise<void> => {
      const isResume = Boolean(opts?.resumeSessionId ?? opts?.geminiResumeTarget);
      const title = opts?.title ?? (isResume ? `${kind} (再開)` : kind);
      let cwd = opts?.cwd;
      if (cwd === undefined) {
        const activeTab = tabsRef.current.find((t) => t.id === activeTabIdRef.current);
        // 記録済みの値ではなく、実プロセスへ問い合わせ直してから spawn する。
        // 「cd した直後に Cmd+Shift+C で claude を開く」という主用途で、記録済みの値のまま
        // spawn すると cd 前の1回分古いディレクトリを引き継いでしまうため。
        // 問い合わせに失敗した場合・cwd が取れなかった場合は、従来どおり記録済みの値、
        // それも無ければ共有 cwd の順にフォールバックする。
        const fallback = activeTab?.cwd ?? getSharedCwd();
        cwd = activeTab
          ? await window.api.pty
              .cwd(activeTab.ptyId)
              .then((result) => result.cwd)
              .catch(() => undefined)
          : undefined;
        cwd = cwd ?? fallback;
      }
      return spawn(kind, title, { ...opts, cwd });
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
      // 購読者がいないまま溜まった出力を破棄する（閉じたタブの分を残さない）。
      forgetPty(tab.ptyId);

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

  // タイトルの手動編集。空文字（trim 後）は既存タイトルを維持する。
  const renameTab = useCallback((id: string, title: string) => {
    const trimmed = title.trim();
    if (trimmed === '') return;
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, title: trimmed } : t)));
  }, []);

  return {
    tabs,
    activeTabId,
    setActiveTabId,
    newShellTab,
    newAgentTab,
    closeTab,
    markExited,
    renameTab,
  };
}
