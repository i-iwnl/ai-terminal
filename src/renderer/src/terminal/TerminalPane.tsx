// タブ1枚分の xterm.js ターミナルを表示するコンポーネント。
//
// 非表示のタブでも Terminal インスタンスは破棄せず、CSS の visibility だけで
// 表示/非表示を切り替える（タブ切り替えでスクロールバックが失われないようにするため）。

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { PtyExitEvent, TerminalTheme } from '@shared/ipc';
import { useTerminal, type TerminalHandle } from './useTerminal';

export interface TerminalPaneProps {
  ptyId: string;
  active: boolean;
  fontFamily: string;
  fontSize: number;
  theme: TerminalTheme;
  screenReaderMode: boolean;
  onExit: (event: PtyExitEvent) => void;
}

const TerminalPane = forwardRef<TerminalHandle, TerminalPaneProps>(function TerminalPane(
  { ptyId, active, fontFamily, fontSize, theme, screenReaderMode, onExit },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const handle = useTerminal(containerRef, {
    ptyId,
    fontFamily,
    fontSize,
    theme,
    screenReaderMode,
    onExit,
    onSearchVisibilityChange: setSearchOpen,
  });

  useImperativeHandle(ref, () => handle, [handle]);

  // タブがアクティブになったタイミングでフォーカスとフィットをやり直す。
  useEffect(() => {
    if (!active) return;
    handle.focus();
    handle.fit();
  }, [active, handle]);

  return (
    <div className={`terminal-pane${active ? '' : ' terminal-pane--hidden'}`}>
      {searchOpen && (
        <div className="terminal-search">
          <input
            autoFocus
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                handle.closeSearch();
              } else if (e.key === 'Enter') {
                e.stopPropagation();
                if (e.shiftKey) handle.findPrevious(searchTerm);
                else handle.findNext(searchTerm);
              }
            }}
            placeholder="検索"
          />
          <button onClick={() => handle.findPrevious(searchTerm)} title="前を検索">
            前
          </button>
          <button onClick={() => handle.findNext(searchTerm)} title="次を検索">
            次
          </button>
          <button onClick={() => handle.closeSearch()} title="検索を閉じる">
            x
          </button>
        </div>
      )}
      <div className="terminal-pane__container" ref={containerRef} />
    </div>
  );
});

export default TerminalPane;
