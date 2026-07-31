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
  /**
   * このタブが現在表示されているか（タブ切り替えの可視性）。
   * `.terminal-pane--hidden`（visibility: hidden）を切り替える。
   * 分割（Issue #56 PR 4）前は `active` と同じ意味だったが、1タブに複数ペインが
   * 並ぶようになったため、「タブが見えているか」（この prop）と「このペインが
   * フォーカス中か」（`active`）を分離した。同じタブの中の非アクティブなペインも
   * `visible` は true のまま（**分割の意味そのもの**。両方の xterm-screen が
   * 同時に見えていないと分割にならない）。
   */
  visible: boolean;
  /**
   * このペインがタブの中でフォーカス中（`TabState.activePaneId`）か。
   * `.terminal-pane.is-active` の唯一の hook（design-review.md の PR 4 関門）。
   * xterm へのフォーカス・fit のやり直し・screenReaderMode の対象もこれで決める
   * （S37 が固定する「露出している .xterm-accessibility は常に1個」を保つため、
   * screenReaderMode は呼び出し側で `visible && active` 相当の値だけを渡すこと）。
   */
  active: boolean;
  /**
   * このペインを指す DOM の id。タブバーの `role="tab"` が `aria-controls` で参照する。
   * ARIA 仕様は tab に対応する tabpanel を要求するので、対にして初めて role が嘘にならない。
   * **木のルート（分割していないタブ、またはツリーのルートを描画する側）だけが渡す。**
   * 分割で入れ子になった leaf は渡さない（1つのタブに複数の role="tabpanel" を
   * 作らないため。App.tsx 側の描画がツリーのルートを判定して渡し分ける）。
   */
  panelId?: string;
  /** このペインを説明する `role="tab"` の要素の id（`aria-labelledby` に使う）。panelId と同様、ルートだけが渡す。 */
  labelledBy?: string;
  fontFamily: string;
  fontSize: number;
  theme: TerminalTheme;
  screenReaderMode: boolean;
  onExit: (event: PtyExitEvent) => void;
  /**
   * このペインに DOM フォーカスが入ったときに呼ばれる（クリックでの
   * ペイン切り替え）。省略可（テスト等で不要な場合のため）。
   * 呼び出し側は、これを見て `TabState.activePaneId` を更新する
   * （矢印キーでのペイン間移動は別 PR。ここはマウス操作の最小限の配線）。
   */
  onActivate?: () => void;
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
  {
    ptyId,
    visible,
    active,
    panelId,
    labelledBy,
    fontFamily,
    fontSize,
    theme,
    screenReaderMode,
    onExit,
    onActivate,
  },
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
      className={`terminal-pane${visible ? '' : ' terminal-pane--hidden'}${active ? ' is-active' : ''}`}
      // タブバーの role="tab" と対になる tabpanel。ARIA 仕様は tab に aria-controls で
      // 対応する tabpanel を要求するので、片方だけ足すと role が嘘になる。
      // 非表示のタブは terminal-pane--hidden（visibility: hidden）で
      // アクセシビリティツリーから除かれるため、露出する tabpanel は常に1個。
      // panelId は木のルートを描画する側だけが渡す（分割で入れ子になった leaf は
      // 渡さない。TerminalPaneProps の panelId コメント参照）。
      id={panelId}
      role={panelId ? 'tabpanel' : undefined}
      aria-labelledby={labelledBy}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      // クリックでこのペインへフォーカスが入ったら、アプリ側の「アクティブなペイン」も
      // 追従させる（Cmd+F / Cmd+W 等のグローバル操作が正しいペインへ向かうため）。
      // xterm 自身のクリック処理が自分の隠し textarea を focus() するので、
      // capture フェーズで拾えば十分（子孫からのバブルも拾える）。
      onFocusCapture={onActivate}
    >
      {searchOpen && (
        <div className="terminal-search">
          <input
            autoFocus
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              // useTerminal 側にも控えておく。グローバルショートカット（Cmd+G 等）は
              // この入力欄にフォーカスが無い状態でも呼ばれるため、React state ではなく
              // handle が持つ最新値を見て検索する。
              handle.setSearchTerm(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                handle.closeSearch();
              } else if (e.key === 'Enter') {
                e.stopPropagation();
                if (e.shiftKey) handle.findPrevious();
                else handle.findNext();
              }
            }}
            placeholder="検索"
          />
          <button onClick={() => handle.findPrevious()} title="前を検索">
            前
          </button>
          <button onClick={() => handle.findNext()} title="次を検索">
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
