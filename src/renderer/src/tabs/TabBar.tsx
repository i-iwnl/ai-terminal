// タブバー。「+」で新しいシェルタブを開き、各タブの「x」で閉じる。
// ウィンドウのドラッグ領域も兼ねる（タブ・ボタン部分は no-drag）。

import type { TabState } from './useTabs';

export interface TabBarProps {
  tabs: TabState[];
  activeTabId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNewShell: () => void;
}

export default function TabBar({ tabs, activeTabId, onSelect, onClose, onNewShell }: TabBarProps) {
  return (
    <div className="tab-bar">
      <div className="tab-bar__tabs">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab-bar__tab${tab.id === activeTabId ? ' is-active' : ''}${
              tab.exit ? ' is-exited' : ''
            }`}
            onClick={() => onSelect(tab.id)}
          >
            <span className="tab-bar__title">{tab.title}</span>
            {tab.exit && <span className="tab-bar__exit-badge">終了</span>}
            <button
              className="tab-bar__close"
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
              aria-label="タブを閉じる"
              title="タブを閉じる"
            >
              x
            </button>
          </div>
        ))}
        <button className="tab-bar__new" onClick={onNewShell} aria-label="新しいシェルタブ" title="新しいシェルタブ">
          +
        </button>
      </div>
      <div className="tab-bar__drag-region" />
    </div>
  );
}
