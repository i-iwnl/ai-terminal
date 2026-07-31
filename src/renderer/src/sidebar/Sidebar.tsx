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

import { useState } from 'react';
import type { SessionHistoryEntry } from '@shared/ipc';
import TaskList from './TaskList';
import HistoryList from './HistoryList';
import MemoPanel, { type MemoTarget } from './MemoPanel';

type SidebarTab = 'tasks' | 'history' | 'memo';

export interface SidebarProps {
  onFocusTaskTab: (agentSessionId: string) => void;
  canFocusTaskTab: (agentSessionId: string) => boolean;
  onResumeHistory: (entry: SessionHistoryEntry) => void;
  /** タスク一覧の空状態にある「起動」ボタン用（Issue #20 I-3） */
  onLaunchClaude: () => void;
}

export default function Sidebar({
  onFocusTaskTab,
  canFocusTaskTab,
  onResumeHistory,
  onLaunchClaude,
}: SidebarProps) {
  const [tab, setTab] = useState<SidebarTab>('tasks');
  const [memoTarget, setMemoTarget] = useState<MemoTarget | null>(null);

  const openMemo = (target: MemoTarget): void => {
    setMemoTarget(target);
    setTab('memo');
  };

  // メモの空状態（対象未選択）から履歴タブへ飛ばすボタン用（Issue #20 I-3の循環参照対策）。
  // 履歴一覧の行の「メモ」ボタンを押すのが本来の導線だが、履歴タブを一度も開いていない
  // 利用者はその行の存在自体を知らないため、メモタブ側にも往路を用意する。
  const goToHistory = (): void => setTab('history');

  return (
    <nav className="sidebar" aria-label="サイドバー">
      <div className="sidebar__drag-region" />
      <div className="sidebar__tabs">
        <button className={tab === 'tasks' ? 'is-active' : ''} onClick={() => setTab('tasks')}>
          タスク
        </button>
        <button className={tab === 'history' ? 'is-active' : ''} onClick={() => setTab('history')}>
          履歴
        </button>
        <button className={tab === 'memo' ? 'is-active' : ''} onClick={() => setTab('memo')}>
          メモ
        </button>
      </div>
      <div className="sidebar__content">
        {tab === 'tasks' && (
          <TaskList
            onFocusTab={onFocusTaskTab}
            canFocus={canFocusTaskTab}
            onLaunchClaude={onLaunchClaude}
          />
        )}
        {tab === 'history' && <HistoryList onResume={onResumeHistory} onOpenMemo={openMemo} />}
        {tab === 'memo' && (
          <MemoPanel target={memoTarget} onSelectTarget={setMemoTarget} onGoToHistory={goToHistory} />
        )}
      </div>
    </nav>
  );
}
