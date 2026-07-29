// タブ1枚分の xterm.js ターミナルを表示するコンポーネント。
//
// 非表示のタブでも Terminal インスタンスは破棄せず、CSS の visibility だけで
// 表示/非表示を切り替える（タブ切り替えでスクロールバックが失われないようにするため）。

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';
import type { PtyExitEvent, TerminalTheme } from '@shared/ipc';
import { useTerminal, type TerminalHandle } from './useTerminal';
import { buildDropInsertion, pathsFromUriList } from '../lib/dropPath';

export interface TerminalPaneProps {
  ptyId: string;
  active: boolean;
  fontFamily: string;
  fontSize: number;
  theme: TerminalTheme;
  screenReaderMode: boolean;
  onExit: (event: PtyExitEvent) => void;
}

/**
 * ドロップされた DataTransfer から絶対パスを取り出す。
 *
 * 経路は2本ある。Finder からのドラッグは両方を持っているので `files` を優先し、
 * そちらでパスが引けなかったときだけ `text/uri-list` へ落とす。
 * uri-list 側は他アプリからの URI ドラッグへの対応でもあり、
 * **合成 DataTransfer で E2E から検証できる唯一の経路**でもある。
 */
function extractDroppedPaths(dataTransfer: DataTransfer): string[] {
  const fromFiles = Array.from(dataTransfer.files)
    .map((file) => window.api.app.pathForFile(file))
    .filter((path) => path !== '');
  if (fromFiles.length > 0) return fromFiles;
  return pathsFromUriList(dataTransfer.getData('text/uri-list'));
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

  // ドラッグ中にブラウザ既定の「そのファイルを開く」挙動へ渡さないことが第一。
  // dropEffect を copy にすると、カーソルが `+` 付きになって落とせることが伝わる。
  const handleDragOver = (e: ReactDragEvent<HTMLDivElement>): void => {
    if (!e.dataTransfer.types.includes('Files') && !e.dataTransfer.types.includes('text/uri-list')) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  // ドロップされたパスは、**アクティブなペインではなくドロップされたこのペイン**の PTY へ送る。
  // 他のターミナルと同じ挙動で、分割表示でも自明に動く。
  const handleDrop = (e: ReactDragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    const data = buildDropInsertion(extractDroppedPaths(e.dataTransfer));
    if (data === '') return;
    window.api.pty.input({ ptyId, data });
    // 続けて打てるようにフォーカスを戻す（ドラッグ元のアプリから戻ってきた直後のため）
    handle.focus();
  };

  return (
    <div
      className={`terminal-pane${active ? '' : ' terminal-pane--hidden'}`}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
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
