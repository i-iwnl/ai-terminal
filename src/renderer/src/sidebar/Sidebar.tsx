// 左サイドバー。「タスク」「履歴」「メモ」の3タブ切り替え。
// 上部はウィンドウのドラッグ領域（macOS の信号機ボタンと重ならないよう余白を確保する）。
//
// 履歴一覧の「メモ」ボタンからメモタブへ飛ばせるよう、選択中のセッションメモは
// 両方の親であるこのコンポーネントが持つ。

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
}

export default function Sidebar({ onFocusTaskTab, canFocusTaskTab, onResumeHistory }: SidebarProps) {
  const [tab, setTab] = useState<SidebarTab>('tasks');
  const [memoTarget, setMemoTarget] = useState<MemoTarget | null>(null);

  const openMemo = (target: MemoTarget): void => {
    setMemoTarget(target);
    setTab('memo');
  };

  return (
    <aside className="sidebar">
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
        {tab === 'tasks' && <TaskList onFocusTab={onFocusTaskTab} canFocus={canFocusTaskTab} />}
        {tab === 'history' && <HistoryList onResume={onResumeHistory} onOpenMemo={openMemo} />}
        {tab === 'memo' && <MemoPanel target={memoTarget} onSelectTarget={setMemoTarget} />}
      </div>
    </aside>
  );
}
