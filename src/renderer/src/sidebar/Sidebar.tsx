// 左サイドバー。「タスク」「履歴」の2タブ切り替え。
// 上部はウィンドウのドラッグ領域（macOS の信号機ボタンと重ならないよう余白を確保する）。

import { useState } from 'react';
import type { SessionHistoryEntry } from '@shared/ipc';
import TaskList from './TaskList';
import HistoryList from './HistoryList';

type SidebarTab = 'tasks' | 'history';

export interface SidebarProps {
  onFocusTaskTab: (agentSessionId: string) => void;
  canFocusTaskTab: (agentSessionId: string) => boolean;
  onResumeHistory: (entry: SessionHistoryEntry) => void;
}

export default function Sidebar({ onFocusTaskTab, canFocusTaskTab, onResumeHistory }: SidebarProps) {
  const [tab, setTab] = useState<SidebarTab>('tasks');

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
      </div>
      <div className="sidebar__content">
        {tab === 'tasks' ? (
          <TaskList onFocusTab={onFocusTaskTab} canFocus={canFocusTaskTab} />
        ) : (
          <HistoryList onResume={onResumeHistory} />
        )}
      </div>
    </aside>
  );
}
