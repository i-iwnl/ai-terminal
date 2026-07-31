// ターミナルタブの状態管理（生成・切り替え・終了）。
// xterm.js インスタンス自体は terminal/TerminalPane.tsx 側が持つ。ここではタブのメタデータと
// PTY の起動・終了だけを扱う。

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PtyKind, SpawnPtyRequest } from '@shared/ipc';
import { getSharedCwd, setSharedCwd } from '../lib/cwd';
import { forgetPty } from '../terminal/ptyStream';
import { createPaneTree, updateLeaf, type PaneLeaf } from './paneTree';
import { findTabByPtyId, tabLeaf, type TabState } from './tabPane';
import { resolveAgentTabTitle } from './tabTitle';

export type { TabState };

// シェルの cd への追従ポーリング間隔。
// エージェントタブ（claude / gemini）は自分から cd しないので対象外。
// tmux でラップして起動している場合、lsof が返すのは tmux クライアント側の cwd で
// シェルの実際の作業ディレクトリとは無関係になるため、これも対象外にする理由の一つ。
const CWD_POLL_INTERVAL_MS = 2_000;

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
          const tab = findTabByPtyId(prev, ptyId);
          if (!tab || tabLeaf(tab).cwd === result.cwd) return prev;
          const paneId = tabLeaf(tab).paneId;
          return prev.map((t) =>
            t.id === tab.id ? { ...t, layout: updateLeaf(t.layout, paneId, { cwd: result.cwd }) } : t,
          );
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
  //
  // PTY のメタ（cwd / kind / ptyId）は木の leaf に持たせてある（design-review Q4）ので、
  // まず tabLeaf() でそのタブの唯一の leaf を引いてから読む（PR 3 の時点では木は
  // 常に leaf 1枚なので、実質「そのタブの PTY のメタ」を引くのと同じ）。
  useEffect(() => {
    const tab = tabsRef.current.find((t) => t.id === activeTabId);
    if (!tab) return;
    const leaf = tabLeaf(tab);
    setSharedCwd(leaf.cwd);
    if (leaf.ptyKind !== 'shell') return;
    const ptyId = leaf.ptyId;
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
        // PTY のメタは全て leaf に持たせる（design-review Q4）。木は常に leaf 1枚
        // （splitPane はこの PR のどこからも呼ばない）ので、paneId は tab.id と
        // 同じ値（spawn 結果の ptyId）を採番時に使う。
        const newLeaf: PaneLeaf = {
          kind: 'leaf',
          paneId: result.ptyId,
          ptyId: result.ptyId,
          ptyKind: kind,
          title,
          agentSessionId: result.agentSessionId,
          cwd,
        };
        const tab: TabState = {
          id: result.ptyId,
          layout: createPaneTree(newLeaf),
          activePaneId: newLeaf.paneId,
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
      let cwd = opts?.cwd;
      if (cwd === undefined) {
        const activeTab = tabsRef.current.find((t) => t.id === activeTabIdRef.current);
        const activeLeaf = activeTab ? tabLeaf(activeTab) : undefined;
        // 記録済みの値ではなく、実プロセスへ問い合わせ直してから spawn する。
        // 「cd した直後に Cmd+Shift+C で claude を開く」という主用途で、記録済みの値のまま
        // spawn すると cd 前の1回分古いディレクトリを引き継いでしまうため。
        // 問い合わせに失敗した場合・cwd が取れなかった場合は、従来どおり記録済みの値、
        // それも無ければ共有 cwd の順にフォールバックする。
        const fallback = activeLeaf?.cwd ?? getSharedCwd();
        cwd = activeLeaf
          ? await window.api.pty
              .cwd(activeLeaf.ptyId)
              .then((result) => result.cwd)
              .catch(() => undefined)
          : undefined;
        cwd = cwd ?? fallback;
      }
      // タイトルの決定は cwd が確定してから行う（既定値が basename(cwd) のため）。
      const title = resolveAgentTabTitle(kind, cwd, isResume, opts?.title);
      return spawn(kind, title, { ...opts, cwd });
    },
    [spawn],
  );

  const closeTab = useCallback(
    async (id: string): Promise<void> => {
      const tab = tabsRef.current.find((t) => t.id === id);
      if (!tab) return;
      const leaf = tabLeaf(tab);
      try {
        await window.api.pty.kill(leaf.ptyId);
      } catch (err) {
        // 既に終了している場合などは失敗しうる。タブは閉じてよいので無視する。
        console.warn('[tabs] PTY の終了に失敗しました', err);
      }
      // 購読者がいないまま溜まった出力を破棄する（閉じたタブの分を残さない）。
      forgetPty(leaf.ptyId);

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
    setTabs((prev) => {
      const tab = findTabByPtyId(prev, ptyId);
      if (!tab) return prev;
      const paneId = tabLeaf(tab).paneId;
      return prev.map((t) => (t.id === tab.id ? { ...t, layout: updateLeaf(t.layout, paneId, { exit }) } : t));
    });
  }, []);

  // タイトルの手動編集。空文字（trim 後）は既存タイトルを維持する。
  const renameTab = useCallback((id: string, title: string) => {
    const trimmed = title.trim();
    if (trimmed === '') return;
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        const paneId = tabLeaf(t).paneId;
        return { ...t, layout: updateLeaf(t.layout, paneId, { title: trimmed }) };
      }),
    );
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
