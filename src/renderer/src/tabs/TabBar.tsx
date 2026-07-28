// タブバー。「+」で新しいシェルタブを開き、各タブの「x」で閉じる。
// タイトルをダブルクリックするとインライン編集できる。
// ウィンドウのドラッグ領域も兼ねる（タブ・ボタン部分は no-drag）。

import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import type { TabState } from './useTabs';

export interface TabBarProps {
  tabs: TabState[];
  activeTabId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNewShell: () => void;
  onRename: (id: string, title: string) => void;
}

export default function TabBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onNewShell,
  onRename,
}: TabBarProps) {
  // 編集中のタブ ID と、編集中の下書き文字列。編集中でなければ editingTabId は null。
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  // editingTabId の state 更新は非同期なので、Enter -> blur のように同一ティック内で
  // 二重確定を防ぎたい箇所は、同期的に更新できるこの ref を見て判定する。
  const editingTabIdRef = useRef<string | null>(null);

  const setEditing = (id: string | null): void => {
    editingTabIdRef.current = id;
    setEditingTabId(id);
  };

  // タブが閉じられるなどして編集中のタブが消えたら、編集状態を破棄する。
  useEffect(() => {
    if (editingTabId !== null && !tabs.some((t) => t.id === editingTabId)) {
      setEditing(null);
    }
  }, [tabs, editingTabId]);

  const startEditing = (tab: TabState): void => {
    setEditing(tab.id);
    setDraft(tab.title);
  };

  const commitEditing = (): void => {
    if (editingTabIdRef.current === null) return;
    onRename(editingTabIdRef.current, draft);
    setEditing(null);
  };

  const cancelEditing = (): void => {
    setEditing(null);
  };

  return (
    <div className="tab-bar">
      <div className="tab-bar__tabs">
        {tabs.map((tab) => {
          const isEditing = tab.id === editingTabId;
          return (
            <div
              key={tab.id}
              className={`tab-bar__tab${tab.id === activeTabId ? ' is-active' : ''}${
                tab.exit ? ' is-exited' : ''
              }`}
              onClick={() => onSelect(tab.id)}
            >
              {isEditing ? (
                <input
                  className="tab-bar__title-input"
                  aria-label="タブ名を編集"
                  value={draft}
                  autoFocus
                  onFocus={(e: FocusEvent<HTMLInputElement>) => e.currentTarget.select()}
                  onChange={(e) => setDraft(e.target.value)}
                  onClick={(e: MouseEvent<HTMLInputElement>) => e.stopPropagation()}
                  onDoubleClick={(e: MouseEvent<HTMLInputElement>) => e.stopPropagation()}
                  onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                    if (e.key === 'Enter') {
                      // IME の変換確定の Enter では編集を確定しない。
                      if (e.nativeEvent.isComposing) return;
                      e.preventDefault();
                      // blur が発火して onBlur の二重確定にならないよう、
                      // 確定を先に済ませてから編集状態を抜ける。
                      commitEditing();
                      e.currentTarget.blur();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      cancelEditing();
                      e.currentTarget.blur();
                    }
                  }}
                  onBlur={() => {
                    // Enter/Escape で既に確定・キャンセル済み（ref が変わっている）なら何もしない。
                    if (editingTabIdRef.current === tab.id) commitEditing();
                  }}
                />
              ) : (
                <span
                  className="tab-bar__title"
                  onDoubleClick={(e: MouseEvent<HTMLSpanElement>) => {
                    e.stopPropagation();
                    startEditing(tab);
                  }}
                >
                  {tab.title}
                </span>
              )}
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
          );
        })}
        <button className="tab-bar__new" onClick={onNewShell} aria-label="新しいシェルタブ" title="新しいシェルタブ">
          +
        </button>
      </div>
      <div className="tab-bar__drag-region" />
    </div>
  );
}
