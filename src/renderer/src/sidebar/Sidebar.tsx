// 左サイドバー。「タスク」「履歴」「メモ」の3タブ切り替え。
// 上部はウィンドウのドラッグ領域（macOS の信号機ボタンと重ならないよう余白を確保する）。
//
// 履歴一覧の「メモ」ボタンからメモタブへ飛ばせるよう、選択中のセッションメモは
// 両方の親であるこのコンポーネントが持つ。
//
// ランドマークは <nav> にした（Issue #56 PR 0-c）。ここが切り替えるタスク/履歴/メモは
// アプリの3つの主要な行き先であり、ターミナル本体（<main>）と対等な「別の場所へ移る」操作
// なので、補助的な内容を示す <aside>（role="complementary"）より <nav>（role="navigation"）
// が実態に合う。中の3ボタン自体に role="tablist" を付けるかどうかは Issue #20 PR 9 の
// スコープなので、ここでは構造（ランドマーク）だけを変える。

import { useEffect, useState, type CSSProperties } from 'react';
import type { SessionHistoryEntry, SidebarPanel } from '@shared/ipc';
import TaskList from './TaskList';
import HistoryList from './HistoryList';
import MemoPanel, { type MemoTarget } from './MemoPanel';
import SidebarResizeHandle from './SidebarResizeHandle';

// **語彙の正は `src/shared/ipc.ts` の `SidebarPanel`**（Issue #120 周2）。
// メニュー・ショートカット・ここの3つが同じ語を使う必要があるので、
// ローカルの union を持たない（鉄則3）。

/** パネルの表示名。**メニュー項目のラベルと同じ文字列を使う。** */
const PANEL_LABEL: Record<SidebarPanel, string> = {
  tasks: 'タスク',
  history: '履歴',
  memo: 'メモ',
};

const PANEL_ORDER: readonly SidebarPanel[] = ['tasks', 'history', 'memo'];

export interface SidebarProps {
  /**
   * 畳んでいるか（Cmd+Option+S。Issue #20 K-1）。**状態そのものは App.tsx が持つ**
   * （ここに置くとキーボード / メニューからトグルできない）。ここは受け取った値を
   * クラス名に反映するだけで、幅を 0 にする・支援技術から外すのは
   * styles.css の `.sidebar.is-collapsed` の仕事。
   *
   * 中身をアンマウントしないのは、タブ選択・メモの編集途中・履歴の絞り込み状態が
   * 畳むたびに失われるのを避けるため（TaskList / HistoryList / MemoPanel は
   * それぞれ自前の state を持つ）。
   */
  collapsed: boolean;
  onFocusTaskTab: (agentSessionId: string) => void;
  canFocusTaskTab: (agentSessionId: string) => boolean;
  /** 「タブに戻せる AI」の行を押したとき（tmux セッションへアタッチする） */
  onRecoverSession: (agentSessionId: string, provider: 'claude' | 'gemini') => void;
  /**
   * タスク一覧の行を右クリック／フォーカスしたときに、その行の agentSessionId を
   * App.tsx へ知らせる（Issue #244 周6-a/6-b。`TaskListProps.onTargetSession` 参照）。
   * 対象が一覧から消えたときは `null` が渡る。
   */
  onTargetSession: (agentSessionId: string | null) => void;
  onResumeHistory: (entry: SessionHistoryEntry) => void;
  /** タスク一覧の空状態にある「起動」ボタン用（Issue #20 I-3） */
  onLaunchClaude: () => void;
  /**
   * タスク一覧を起動フォルダに絞り込んでいるか（`AppConfig.scopeAgentsToCwd`）。
   * TaskList のスコープ行の文言にだけ使う（Issue #20 I-2）。
   */
  scopeAgentsToCwd: boolean;
  /**
   * サイドバーの幅（CSS px）。**インラインの `width` ではなく
   * `--sidebar-width` カスタムプロパティとして流す**（インラインスタイルは
   * `.sidebar.is-collapsed { width: 0 }` に詳細度で勝って折りたたみを壊す）。
   */
  width: number;
  /** ドラッグが確定したとき（mouseup）に1回だけ呼ばれる */
  onCommitWidth: (width: number) => void;
  /** メニューから幅を変えたときに `.focus()` するための参照登録 */
  registerResizeHandleRef?: (el: HTMLDivElement | null) => void;
  /**
   * 外から（キーボード / メニュー）パネルを切り替えるための購読登録。
   *
   * **状態は Sidebar が持つ**（タブ選択・メモの編集途中・履歴の絞り込みは
   * すべてこの木の中の state で、App へ持ち上げると畳むたびに失われる）。
   * App 側はこの関数で「切り替えたい」を伝えるだけ。
   */
  registerPanelSwitcher?: (switchTo: ((panel: SidebarPanel) => void) | null) => void;
}

export default function Sidebar({
  collapsed,
  onFocusTaskTab,
  canFocusTaskTab,
  onRecoverSession,
  onTargetSession,
  onResumeHistory,
  onLaunchClaude,
  scopeAgentsToCwd,
  width,
  onCommitWidth,
  registerResizeHandleRef,
  registerPanelSwitcher,
}: SidebarProps) {
  const [tab, setTab] = useState<SidebarPanel>('tasks');
  const [memoTarget, setMemoTarget] = useState<MemoTarget | null>(null);

  const openMemo = (target: MemoTarget): void => {
    setMemoTarget(target);
    setTab('memo');
  };

  // メモの空状態（対象未選択）から履歴タブへ飛ばすボタン用（Issue #20 I-3の循環参照対策）。
  // 履歴一覧の行の「メモ」ボタンを押すのが本来の導線だが、履歴タブを一度も開いていない
  // 利用者はその行の存在自体を知らないため、メモタブ側にも往路を用意する。
  const goToHistory = (): void => setTab('history');

  // キーボード（Cmd+Option+1/2/3）とメニューからの切り替えを受ける。
  // **アンマウント時に必ず解除する**（App 側が古い setter を掴んだままだと、
  // 畳んで開き直したあとの切り替えが効かなくなる）。
  useEffect(() => {
    registerPanelSwitcher?.(setTab);
    return () => registerPanelSwitcher?.(null);
  }, [registerPanelSwitcher]);

  return (
    <nav
      className={`sidebar${collapsed ? ' is-collapsed' : ''}`}
      aria-label="サイドバー"
      style={{ '--sidebar-width': `${width}px` } as CSSProperties}
    >
      <div className="sidebar__drag-region" />
      {/* Issue #120 周2 / 旧 #111: 選択状態を機械可読にする。
          周2 まで手がかりは `className` の `is-active` だけで、`role` /
          `aria-selected` / `aria-current` のいずれも無かった。塗りの差は
          `--surface-3` 対 `--surface-2` で **1.08**（S40 が `wcag: 'fail'` で
          実測固定）なので、支援技術にも色の弱い利用者にも選択が伝わっていない。
          WCAG 4.1.2（名前・役割・値）。

          **`<button>` 要素そのものは変えない。** `e2e/` の 28 ファイル・44 箇所が
          `.sidebar__tabs button` でパネルを切り替えている。`role` を**足す**のは問題ない。

          タブバー側（`TabBar.tsx`）は #86 で既に `role="tablist"` を持っており、
          サイドバーだけが取り残されていた。 */}
      <div className="sidebar__tabs" role="tablist" aria-label="サイドバーのパネル">
        {PANEL_ORDER.map((panel) => (
          <button
            key={panel}
            role="tab"
            id={`sidebar-panel-tab-${panel}`}
            aria-selected={tab === panel}
            aria-controls={`sidebar-panel-${panel}`}
            // roving tabindex。`role="tablist"` の停止点は1つであるべき。
            // ただし**そもそも Tab では到達できない**（xterm のヘルパー textarea が
            // Tab を端末入力として消費する）ので、実際の入口は
            // `Cmd+Option+1/2/3` とメニュー。ARIA で嘘をつかないために
            // 停止点の数だけは正しくしておく。
            tabIndex={tab === panel ? 0 : -1}
            className={tab === panel ? 'is-active' : ''}
            onClick={() => setTab(panel)}
          >
            {PANEL_LABEL[panel]}
          </button>
        ))}
      </div>
      <div
        className="sidebar__content"
        role="tabpanel"
        id={`sidebar-panel-${tab}`}
        aria-labelledby={`sidebar-panel-tab-${tab}`}
      >
        {tab === 'tasks' && (
          <TaskList
            onFocusTab={onFocusTaskTab}
            canFocus={canFocusTaskTab}
            onLaunchClaude={onLaunchClaude}
            scopedToCwd={scopeAgentsToCwd}
            onRecoverSession={onRecoverSession}
            onTargetSession={onTargetSession}
          />
        )}
        {tab === 'history' && <HistoryList onResume={onResumeHistory} onOpenMemo={openMemo} />}
        {tab === 'memo' && (
          <MemoPanel target={memoTarget} onSelectTarget={setMemoTarget} onGoToHistory={goToHistory} />
        )}
      </div>
      {/* 畳んでいるあいだはハンドルを出さない（幅0のサイドバーの右端に
          掴める帯があると、ターミナルの左端 8px が奪われる）。
          `.sidebar.is-collapsed` は visibility: hidden なので描画自体も消えるが、
          当たり判定を確実に外すためにマウント自体をやめる。 */}
      {!collapsed && (
        <SidebarResizeHandle
          width={width}
          onCommitWidth={onCommitWidth}
          registerRef={registerResizeHandleRef}
        />
      )}
    </nav>
  );
}
