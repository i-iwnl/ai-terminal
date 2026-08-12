// ターミナルタブの状態管理（生成・切り替え・終了）。
// xterm.js インスタンス自体は terminal/TerminalPane.tsx 側が持つ。ここではタブのメタデータと
// PTY の起動・終了だけを扱う。

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PtyKind, SpawnPtyRequest } from '@shared/ipc';
import { getSharedCwd, setSharedCwd } from '../lib/cwd';
import { forgetPty } from '../terminal/ptyStream';
import {
  canSplitPane,
  closePane,
  createPaneTree,
  describeSplitRejection,
  flattenPaneTree,
  getLeaf,
  splitPane,
  updateLeaf,
  updateSplitRatio as updateSplitRatioInTree,
  type PaneCellMetrics,
  type PaneLeaf,
  type PanePath,
  type SplitDirection,
} from './paneTree';
import { findPaneByAgentSessionId, findTabByPtyId, tabLeaf, type TabState } from './tabPane';
import { SHELL_FALLBACK_LABEL } from './paneHeader';
// 起動失敗の文言は spawnErrorCopy.ts が唯一の正（E2E から踏めないので unit で固定している）。
import { describeSpawnError } from './spawnErrorCopy';
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
  /** gemini の内部 UUID。⛔ `--resume` には渡らない（用途は src/shared/ipc.ts が唯一の正）。 */
  geminiAgentSessionId?: string;
  /**
   * 生きている tmux セッションへ**アタッチする**ときの `agentSessionId`。
   * これを渡すと CLI の起動コマンドは1つも組み立てられない（src/shared/ipc.ts）。
   */
  attachAgentSessionId?: string;
  cwd?: string;
  /** 指定があればタブタイトルにそのまま使う（履歴からの再開で、履歴一覧の表示名を引き継ぐ用途）。 */
  title?: string;
}

/** `splitActivePane` の結果。拒否された場合は理由（通知バナーにそのまま出せる文）を持つ。 */
export type SplitPaneOutcome = { ok: true } | { ok: false; reason: string };

/**
 * `closeActivePane`（Cmd+W）の結果。design-review.md 提案 E' が要求する
 * 「Cmd+W が『ペインを閉じた』のか『タブごと閉じた』のかを role="status" で
 * 告知する」ための区別。呼び出し側（App.tsx）はこれを見て告知文を出し分ける。
 */
export type CloseActivePaneOutcome = { kind: 'pane-closed' } | { kind: 'tab-closed' };

export interface UseTabsResult {
  tabs: TabState[];
  activeTabId: string | null;
  setActiveTabId: (id: string) => void;
  newShellTab: () => Promise<void>;
  newAgentTab: (kind: 'claude' | 'gemini', opts?: SpawnOpts) => Promise<void>;
  /**
   * タブを閉じる。`terminateSession` は「中の AI も終了させるか」（Issue #244）。
   * 既定は `true`（通常の「閉じる」）。`false` はメニュー
   * 「AI を残してタブを閉じる」からだけ渡る。
   */
  closeTab: (id: string, terminateSession?: boolean) => Promise<void>;
  markExited: (ptyId: string, exit: { exitCode: number; signal?: number }) => void;
  /** タブ自身の名前（Issue #131）。空文字を渡すと未設定に戻り、木の先頭 leaf からの導出に落ちる。 */
  renameTab: (tabId: string, title: string) => void;
  /** そのタブの、指定したペインの名前（Issue #130）。空文字は無視する。 */
  renamePane: (tabId: string, paneId: string, title: string) => void;
  /**
   * アクティブなタブのアクティブなペインを、指定した方向へ分割する（Issue #56 PR 4）。
   * `metrics` は呼び出し側（App.tsx）が対象ペインの `TerminalHandle.getCellMetrics()`
   * で実測した値。分割の可否は幅・高さの比率ではなく実セル寸法で判定する
   * （design-review.md U3。呼び出し側は必ず実測してから呼ぶこと）。
   */
  splitActivePane: (dir: SplitDirection, metrics: PaneCellMetrics) => Promise<SplitPaneOutcome>;
  /**
   * アクティブなタブのアクティブなペインを閉じる（Cmd+W。意味変更）。
   * ペインが1枚しか無い場合は、結果としてタブそのものを閉じる
   * （design-review.md「確定している仕様」）。戻り値は role="status" の
   * 告知文を出し分けるための区別（提案 E'）。
   */
  /** `terminateSession` の意味は `closeTab` と同じ（Issue #244）。 */
  closeActivePane: (terminateSession?: boolean) => Promise<CloseActivePaneOutcome>;
  /**
   * `agentSessionId` からタブ・ペインを引き当てて、そのペインだけを閉じる
   * （実機不具合の差し戻し。App.tsx の `performKillSession` 参照）。
   *
   * タスク一覧の行が `'focus'`（そのセッションのタブが開いている）状態で
   * 「この AI を終了」相当を選んだときの経路。**`agent-session:kill` は呼ばない** —
   * ここが `pty.kill({ terminateSession: true })` を呼ぶことで、tmux セッションの
   * 終了は既に済む。二重に呼ぶと同じセッションに対して2回 `kill-session` が飛ぶ。
   *
   * `closeActivePane`（Cmd+W）と同じ `closePane` の要領だが、対象は「アクティブな
   * タブのアクティブなペイン」に限らない。**そのペインが最後の1枚なら、
   * `closeActivePane` と同じくタブごと閉じる**（`closeTab` に合流する）。
   *
   * 対象が見つからない（既にタブが閉じられた・一覧の情報が古い等）場合は何もしない。
   */
  closePaneForAgentSession: (agentSessionId: string) => Promise<void>;
  /** クリック等でペインにフォーカスが移ったとき、そのタブの activePaneId を更新する。 */
  setActivePaneInTab: (tabId: string, paneId: string) => void;
  /**
   * アクティブなタブの、アクティブなペインの最大化表示をトグルする
   * （Cmd+Shift+Enter。Issue #56 PR 8・design-review.md 提案 I）。
   *
   * **木（`ratio` / 構造）には一切触れず、PTY も kill しない。** 一時的な
   * 表示の切り替えであって木の変形ではない（design-review.md）。実際の
   * レイアウト上書きは `PaneTreeView.tsx` が `tab.maximized` を見て行う。
   */
  toggleMaximizePane: () => void;
  /**
   * 指定したタブの、指定した分割ノード（経路）の ratio を更新する（Issue #56 PR 7）。
   * スプリッタのドラッグ確定（mouseup）とメニュー項目（分割比を広げる/狭める/
   * 50%に戻す）の両方がこの1本を通る。クランプは `paneTree.ts` の
   * `updateSplitRatio` にそのまま委ねる（ここでは書き直さない）。
   */
  updateSplitRatio: (
    tabId: string,
    path: PanePath,
    ratio: number,
    metrics: PaneCellMetrics,
  ) => void;
}

// 初期の桁数/行数。マウント後すぐに fitAddon.fit() で実サイズに補正される。
const INITIAL_COLS = 80;
const INITIAL_ROWS = 24;

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
  //
  // **tabId と ptyId を別に受け取る。** 分割（Issue #56 PR 4）前は
  // `tab.id === アクティブな leaf の ptyId` が常に成立していたため ptyId だけで
  // 事足りたが、分割後にアクティブなペインが（タブ生成時の leaf ではない）
  // 別の leaf に移ると、そのペインの ptyId は tab.id と一致しなくなる。
  // 「このタブが今アクティブか」の判定に ptyId をそのまま使うと常に false になり、
  // サイドバーの共有 cwd が更新されなくなる。
  const refreshTabCwd = useCallback((tabId: string, ptyId: string): void => {
    window.api.pty
      .cwd(ptyId)
      .then((result) => {
        if (!result.cwd) return;
        setTabs((prev) => {
          const tab = prev.find((t) => t.id === tabId);
          if (!tab) return prev;
          const leaf = flattenPaneTree(tab.layout).find((l) => l.ptyId === ptyId);
          if (!leaf || leaf.cwd === result.cwd) return prev;
          return prev.map((t) =>
            t.id === tabId
              ? { ...t, layout: updateLeaf(t.layout, leaf.paneId, { cwd: result.cwd }) }
              : t,
          );
        });
        // このタブがまだアクティブなら、サイドバーへもそのまま反映する。
        if (activeTabIdRef.current === tabId) {
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
  // 以降は cd への追従のためポーリングする。対象はアクティブなタブの**アクティブな
  // ペイン**1枚だけ（分割後、非アクティブなペインの cd 追従は非目標のまま。
  // design-review.md は OSC 7 による実 cwd 追跡そのものを非目標にしている）。
  //
  // PTY のメタ（cwd / kind / ptyId）は木の leaf に持たせてある（design-review Q4）ので、
  // tabLeaf() でそのタブの「今表示すべき」leaf を引いてから読む。
  //
  // 依存配列に activePaneId を含める。分割でアクティブなペインが変わっても
  // activeTabId 自体は変わらないため、含めないとポーリング対象が古い leaf の
  // ままになる（サイドバーが別ペインの cwd を表示し続ける）。
  const activePaneIdForCwdPolling = tabs.find((t) => t.id === activeTabId)?.activePaneId ?? null;
  useEffect(() => {
    const tab = tabsRef.current.find((t) => t.id === activeTabId);
    if (!tab) return;
    const leaf = tabLeaf(tab);
    setSharedCwd(leaf.cwd);
    if (leaf.ptyKind !== 'shell') return;
    const tabId = tab.id;
    const ptyId = leaf.ptyId;
    refreshTabCwd(tabId, ptyId);
    const timer = window.setInterval(() => {
      refreshTabCwd(tabId, ptyId);
    }, CWD_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [activeTabId, activePaneIdForCwdPolling, refreshTabCwd]);

  // PTY を1本起動して PaneLeaf を組み立てるだけの、副作用の小さい単位。
  // 新しいタブを作る（spawn、下）と、既存タブの中にペインを増やす
  // （splitActivePane、後述）の両方から使う共通経路。
  // 失敗時は onError を呼んで null を返す（呼び出し側で「起動しなかった」として扱う）。
  const spawnLeaf = useCallback(
    async (
      kind: PtyKind,
      title: string,
      cwd: string | undefined,
      resumeOpts?: Pick<
        SpawnOpts,
        'resumeSessionId' | 'geminiResumeTarget' | 'geminiAgentSessionId' | 'attachAgentSessionId'
      >,
    ): Promise<PaneLeaf | null> => {
      const req: SpawnPtyRequest = {
        kind,
        cwd,
        cols: INITIAL_COLS,
        rows: INITIAL_ROWS,
        resumeSessionId: resumeOpts?.resumeSessionId,
        geminiResumeTarget: resumeOpts?.geminiResumeTarget,
        geminiAgentSessionId: resumeOpts?.geminiAgentSessionId,
        attachAgentSessionId: resumeOpts?.attachAgentSessionId,
      };
      try {
        const result = await window.api.pty.spawn(req);
        return {
          kind: 'leaf',
          paneId: result.ptyId,
          ptyId: result.ptyId,
          ptyKind: kind,
          // **シェルの既定タイトルは呼び出し側ではなくここで決める**（Issue #137）。
          // 以前は呼び出し側3箇所がリテラル `'zsh'` を渡しており、`$SHELL` が
          // fish/bash の人にも `zsh` と表示していた。**正を1箇所に集める**ため、
          // spawn 結果（Main の buildShellPlan が解決した実際のシェル）を採る。
          // 呼び出し側が明示的なタイトルを渡したとき（履歴からの再開など）は
          // そちらを優先する。
          title:
            kind === 'shell' && title === '' ? (result.shellName ?? SHELL_FALLBACK_LABEL) : title,
          agentSessionId: result.agentSessionId,
          cwd,
          // ペインヘッダ（paneHeader.ts）が「claude (再開)」を出し分けるための
          // フラグ。resumeOpts から直接立てる（title の文字列判定はしない。
          // paneTree.ts の isResume コメント参照）。
          isResume: Boolean(resumeOpts?.resumeSessionId ?? resumeOpts?.geminiResumeTarget),
          // Issue #121 A-3: Main は以前からこの値を返していたのに、ここで
          // 捨てていた。閉じる確認の文言（closeTabCopy.ts）と検索バーの注記が
          // これを読む。**設定値ではなく spawn 時の実際の結果**であることが要点。
          wrappedInTmux: result.wrappedInTmux,
          shellName: result.shellName,
        };
      } catch (err) {
        onError(describeSpawnError(err, kind));
        return null;
      }
    },
    [onError],
  );

  const spawn = useCallback(
    async (kind: PtyKind, title: string, opts?: SpawnOpts): Promise<void> => {
      const cwd = opts?.cwd ?? getSharedCwd();
      const newLeaf = await spawnLeaf(kind, title, cwd, opts);
      if (!newLeaf) return;
      // PTY のメタは全て leaf に持たせる（design-review Q4）。新しいタブを作る
      // 経路では、paneId は tab.id と同じ値（spawn 結果の ptyId）を採番時に使う。
      const tab: TabState = {
        id: newLeaf.ptyId,
        layout: createPaneTree(newLeaf),
        activePaneId: newLeaf.paneId,
        createdAt: Date.now(),
        maximized: false,
      };
      setTabs((prev) => [...prev, tab]);
      setActiveTabIdState(newLeaf.ptyId);
    },
    [spawnLeaf],
  );

  const newShellTab = useCallback(() => spawn('shell', ''), [spawn]);

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
    async (id: string, terminateSession = true): Promise<void> => {
      const tab = tabsRef.current.find((t) => t.id === id);
      if (!tab) return;
      // タブを閉じるときは、木に何枚ペインがあっても**全部**の PTY を kill する。
      // 分割（Issue #56 PR 4）前は木が常に leaf 1枚だったので `tabLeaf(tab)`
      // （アクティブな leaf 1枚だけ）で足りていたが、分割後にそのまま使うと
      // 非アクティブなペインの PTY が2本目以降漏れて、閉じたはずのタブの裏で
      // claude / gemini が動き続ける（design-review.md 提案 E'）。
      const leaves = flattenPaneTree(tab.layout);
      await Promise.all(
        leaves.map(async (leaf) => {
          try {
            // Issue #244: **「タブを閉じる」= 中の AI も終了する。**
            // 直す前は tmux クライアントだけが死に、中の claude / gemini は生き残って
            // 閉じるたびに1本ずつ累積していた（実機で7本）。
            // ⛔ アプリ終了（`before-quit`）はこの経路を通らないので、
            // 「アプリを閉じても生き残る」は影響を受けない（`src/shared/ipc.ts` の
            // `KillPtyRequest` が唯一の正）。
            await window.api.pty.kill({ ptyId: leaf.ptyId, terminateSession });
          } catch (err) {
            // 既に終了している場合などは失敗しうる。タブは閉じてよいので無視する。
            console.warn('[tabs] PTY の終了に失敗しました', err);
          }
          // 購読者がいないまま溜まった出力を破棄する（閉じたタブの分を残さない）。
          forgetPty(leaf.ptyId);
        }),
      );

      const remaining = tabsRef.current.filter((t) => t.id !== id);
      setTabs(remaining);

      if (activeTabIdRef.current === id) {
        const next = remaining[remaining.length - 1];
        setActiveTabIdState(next ? next.id : null);
      }

      if (remaining.length === 0) {
        // 最後の1枚を閉じた場合は、新しいシェルタブを自動で開く。
        void spawn('shell', '');
      }
    },
    [spawn],
  );

  /**
   * アクティブなタブのアクティブなペインを、指定した方向へ分割する（Cmd+D / Cmd+Shift+D）。
   *
   * 分割で作るのは常にシェルペイン（design-review.md 提案 F'）。cwd は分割対象の
   * ペイン（タブ生成時の cwd を持つ leaf）から引き継ぐ。**実 cwd の追跡ではない**
   * ことに注意（非目標。known-issues 参照）。
   */
  const splitActivePane = useCallback(
    async (dir: SplitDirection, metrics: PaneCellMetrics): Promise<SplitPaneOutcome> => {
      const tabId = activeTabIdRef.current;
      const tab = tabId ? tabsRef.current.find((t) => t.id === tabId) : undefined;
      if (!tab) return { ok: false, reason: 'アクティブなタブがありません' };

      if (!canSplitPane(metrics, dir)) {
        return { ok: false, reason: describeSplitRejection(dir) };
      }

      const activeLeaf = tabLeaf(tab);
      const newLeaf = await spawnLeaf('shell', '', activeLeaf.cwd);
      if (!newLeaf) {
        // spawnLeaf は失敗時に onError 経由で既に通知を出している。
        return { ok: false, reason: '新しいペインの起動に失敗しました' };
      }

      const nextTree = splitPane(tab.layout, tab.activePaneId, dir, newLeaf, metrics);
      if (!nextTree) {
        // canSplitPane を事前に見ているのでここには通常来ないが、万一に備えて
        // 起動してしまった PTY を後始末する（漏れを防ぐ）。
        try {
          // ⚠ ここは実質 no-op（分割で作るのはシェルペインで、`maybeWrapWithTmux` が
          // `kind === 'shell'` を必ず素通しするため tmux セッションが存在しない）。
          // それでも `true` を渡すのは、**この分岐の意図が「作ってしまったものを
          // 完全に無かったことにする」**だからで、将来 AI ペインで分割できるように
          // なったときに黙って漏れないようにするため。
          await window.api.pty.kill({ ptyId: newLeaf.ptyId, terminateSession: true });
        } catch (err) {
          console.warn('[tabs] PTY の終了に失敗しました', err);
        }
        forgetPty(newLeaf.ptyId);
        return { ok: false, reason: '分割に失敗しました' };
      }

      // 新しいペインへフォーカスを移す（分割したら、その場でそこに打てる状態にする）。
      // maximized は false に戻す（PR 8）: 木の構造が変わった以上、最大化中の
      // 「表示中の1枚」という前提が崩れるため、分割のたびに通常表示へ戻す。
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tab.id
            ? { ...t, layout: nextTree, activePaneId: newLeaf.paneId, maximized: false }
            : t,
        ),
      );
      return { ok: true };
    },
    [spawnLeaf],
  );

  /**
   * アクティブなタブのアクティブなペインを閉じる（Cmd+W。意味変更）。
   * ペインが1枚しか無い（`closePane` が畳む先を持たない）場合は、結果として
   * タブそのものを閉じる（design-review.md「確定している仕様」）。
   *
   * 戻り値（`CloseActivePaneOutcome`）は、呼び出し側（App.tsx）が
   * role="status" の告知文を「ペインを閉じた」/「タブを閉じた」で
   * 出し分けるために使う（design-review.md 提案 E'。Cmd+W を押した結果を
   * 視覚以外の手段で区別する唯一の手がかり）。
   */
  const closeActivePane = useCallback(
    async (terminateSession = true): Promise<CloseActivePaneOutcome> => {
      const tabId = activeTabIdRef.current;
      if (!tabId) return { kind: 'pane-closed' };
      const tab = tabsRef.current.find((t) => t.id === tabId);
      if (!tab) return { kind: 'pane-closed' };

      const result = closePane(tab.layout, tab.activePaneId);
      if (result === null) {
        await closeTab(tabId, terminateSession);
        return { kind: 'tab-closed' };
      }

      const closedLeaf = getLeaf(tab.layout, tab.activePaneId);
      if (closedLeaf) {
        try {
          // Issue #244: ペイン1枚を閉じる経路。**`closeTab` とは別の呼び出し箇所**なので、
          // 片方だけ直すと分割中のタブでだけ累積が続く（S107 が両方を踏む）。
          await window.api.pty.kill({ ptyId: closedLeaf.ptyId, terminateSession });
        } catch (err) {
          console.warn('[tabs] PTY の終了に失敗しました', err);
        }
        forgetPty(closedLeaf.ptyId);
      }

      // maximized は false に戻す（PR 8）: splitActivePane と同じ理由
      // （木の構造が変わった以上、最大化中の前提が崩れる）。
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tabId
            ? { ...t, layout: result.tree, activePaneId: result.activePaneId, maximized: false }
            : t,
        ),
      );
      return { kind: 'pane-closed' };
    },
    [closeTab],
  );

  /**
   * `agentSessionId` から引き当てたペインだけを閉じる（実機不具合の差し戻し）。
   * `UseTabsResult.closePaneForAgentSession` の doc 参照。
   *
   * **`closeActivePane` と重複しているように見えるが、対象の決め方が違う。**
   * あちらは常に「いまアクティブなタブの、いまアクティブなペイン」が対象で
   * `activeTabIdRef` / `tab.activePaneId` を暗黙に読む。こちらは呼び出し側
   * （タスク一覧の行）が指す対象が、いま前面に出ているタブ・ペインとは限らない
   * （むしろ大抵は違う）ため、`agentSessionId` から明示的に `tabId` / `paneId` を
   * 引き当ててから同じ `closePane` の要領で閉じる。
   */
  const closePaneForAgentSession = useCallback(
    async (agentSessionId: string): Promise<void> => {
      const location = findPaneByAgentSessionId(tabsRef.current, agentSessionId);
      if (!location) return;
      const tab = tabsRef.current.find((t) => t.id === location.tabId);
      if (!tab) return;

      const result = closePane(tab.layout, location.paneId);
      if (result === null) {
        // 最後の1枚だった。closeActivePane と同じくタブごと閉じる経路に合流する
        // （tmux セッションの終了は closeTab 内の pty.kill が担う）。
        await closeTab(tab.id, true);
        return;
      }

      const closedLeaf = getLeaf(tab.layout, location.paneId);
      if (closedLeaf) {
        try {
          await window.api.pty.kill({ ptyId: closedLeaf.ptyId, terminateSession: true });
        } catch (err) {
          console.warn('[tabs] PTY の終了に失敗しました', err);
        }
        forgetPty(closedLeaf.ptyId);
      }

      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== tab.id) return t;
          // 閉じたペインが、そのタブの activePaneId そのものだったときだけ
          // closePane が返す新しい activePaneId へ差し替える。**対象のタブが
          // 前面に出ていない（＝閉じたのが activePaneId と無関係な過去の値）
          // ことのほうが多いので、無条件の上書きはしない**（他のペインへ
          // フォーカスが飛んで見える副作用を避ける）。
          const activePaneId =
            t.activePaneId === location.paneId ? result.activePaneId : t.activePaneId;
          return { ...t, layout: result.tree, activePaneId, maximized: false };
        }),
      );
    },
    [closeTab],
  );

  /**
   * アクティブなタブの、アクティブなペインの最大化表示をトグルする
   * （Cmd+Shift+Enter。Issue #56 PR 8・design-review.md 提案 I）。
   *
   * ここでは真偽値を反転させるだけ。実際にどのペインを最大化するかは
   * 「今の `activePaneId`」がそのまま対象になる（`PaneTreeView.tsx` 側の
   * 解釈）ため、ペイン間移動（`Cmd+]` 等）で `activePaneId` が変わっても
   * 最大化状態はそのまま追従する。
   */
  const toggleMaximizePane = useCallback((): void => {
    const tabId = activeTabIdRef.current;
    if (!tabId) return;
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, maximized: !t.maximized } : t)));
  }, []);

  /** クリック等でペインにフォーカスが移ったとき、そのタブの activePaneId を更新する。 */
  const setActivePaneInTab = useCallback((tabId: string, paneId: string) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId && t.activePaneId !== paneId ? { ...t, activePaneId: paneId } : t,
      ),
    );
  }, []);

  /**
   * スプリッタのドラッグ確定（mouseup）とメニュー項目（分割比を広げる/狭める/
   * 50%に戻す）の両方から呼ばれる、分割ノードの ratio 更新の唯一の入口
   * （Issue #56 PR 7）。
   *
   * **ここで React state（setTabs）を書き換えるのは呼び出し1回につき1回だけ。**
   * ドラッグ中は `PaneSplitterHandle.tsx` がゴースト線だけを動かし、この関数は
   * `mouseup` の瞬間にしか呼ばれない。ドラッグ中に何度も呼ばれる経路ではないため、
   * ここで `.pane-split__cell` の flex-grow が実際に変わるのも mouseup 後の
   * 1回だけになる（design-review.md 提案 D' の関門）。
   */
  const updateSplitRatio = useCallback(
    (tabId: string, path: PanePath, ratio: number, metrics: PaneCellMetrics): void => {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tabId
            ? { ...t, layout: updateSplitRatioInTree(t.layout, path, ratio, metrics) }
            : t,
        ),
      );
    },
    [],
  );

  const markExited = useCallback((ptyId: string, exit: { exitCode: number; signal?: number }) => {
    setTabs((prev) => {
      const tab = findTabByPtyId(prev, ptyId);
      if (!tab) return prev;
      // exit した PTY を持つ leaf を探して更新する。`tabLeaf(tab)`（アクティブな
      // leaf 1枚だけ）ではなく木の全 leaf を見る必要がある理由は
      // findTabByPtyId のコメント（tabPane.ts）と同じ（分割後、非アクティブな
      // ペインで exit しうる）。
      const leaf = flattenPaneTree(tab.layout).find((l) => l.ptyId === ptyId);
      if (!leaf) return prev;
      return prev.map((t) =>
        t.id === tab.id ? { ...t, layout: updateLeaf(t.layout, leaf.paneId, { exit }) } : t,
      );
    });
  }, []);

  // 名前の手動編集。空文字（trim 後）は既存の名前を維持する。
  //
  // **書き込み先はタブではなく、そのタブのアクティブなペイン。** `title` は
  // `PaneLeaf` の属性で、タブ側に名前という属性は存在しない（design-review Q4 で
  // PTY のメタを leaf に移した結果）。分割中に呼べば、いま見ているペインの
  // 名前だけが変わる。**Issue #130 以前は関数名が `renameTab` で、この事実が
  // 名前と食い違っていた。**
  //
  // `renamed: true` を同時に立てるのが要点。ペインヘッダ（paneHeader.ts）が
  // 「そのペインの名前」と「種別・cwd」のどちらを出すかをこのフラグで決める。
  // **title の文字列比較では判定できない**（paneTree.ts の `renamed` コメント参照）。
  // タブ自身の名前（Issue #131）。**ペインの名前とは別物。**
  //
  // 空文字（trim 後）は `undefined` に畳んで導出（`tabDisplayTitle` = 木の先頭
  // leaf の title）へ戻す。**`renamePane` とは非対称**で、あちらは空文字を
  // 「変更しない」として無視する。理由は既定値の有無で、ペインの名前には
  // 常に spawn 時の既定（シェル名 / `basename(cwd)`）があるのに対し、タブの名前は
  // 未設定が正常な状態なので、「消して既定に戻す」経路が要る。
  const renameTab = useCallback((tabId: string, title: string) => {
    const trimmed = title.trim();
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, title: trimmed === '' ? undefined : trimmed } : t)),
    );
  }, []);

  const renamePane = useCallback((tabId: string, paneId: string, title: string) => {
    const trimmed = title.trim();
    if (trimmed === '') return;
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId
          ? { ...t, layout: updateLeaf(t.layout, paneId, { title: trimmed, renamed: true }) }
          : t,
      ),
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
    renamePane,
    splitActivePane,
    closeActivePane,
    closePaneForAgentSession,
    setActivePaneInTab,
    updateSplitRatio,
    toggleMaximizePane,
  };
}
