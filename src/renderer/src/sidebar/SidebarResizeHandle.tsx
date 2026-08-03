// サイドバー右端のリサイズハンドル（Issue #119 周4 / #20 の PR 16）。
//
// **ゴースト方式。** ドラッグ中は `.sidebar` の幅を一切変えず、`position: fixed` の
// ゴースト線だけを動かす。`mouseup` で初めて確定した幅を呼び出し側へ渡す。
//
// `PaneSplitterHandle.tsx` と同じ方式で、理由も同じ。実際に `.sidebar` の幅を
// 書き換えると `.terminal-stack` の実ピクセル寸法が変わり、
// `ResizeObserver -> fitAddon.fit() -> pty.resize() -> node-pty の TIOCSWINSZ
// -> SIGWINCH` まで連鎖する。しかも**全タブの TerminalPane が同時にマウントされ、
// 非表示タブも `visibility: hidden` でレイアウトを持つ**ため
// `clientWidth === 0` のガードを通過する（タブ10枚なら1px 動かすたびに 10 回）。
//
// ゴースト方式なら実レイアウトが動くのは mouseup 後の1回だけなので、
// 「ドラッグ中は fit() を丸ごとスキップする」という対症療法も、
// `transition: width` の禁止も要らなくなる（そもそも遷移中に何も起きない）。
//
// **タブ順には入れない（`tabIndex={-1}`）。** Tab キーは xterm が端末入力として
// 食うのでフォーカスが端末にある限り到達できず、ARIA で「到達できる」と嘘を
// つくことになる。ただしメニュー項目「サイドバーを広げる / 狭める」が
// 動かした対象へ `.focus()` してリングを見せられるよう、属性そのものは持たせる
// （`PaneSplitterHandle.tsx` の tabIndex に関する長いコメントが同じ判断の記録）。
//
// **ドラッグ以外の手段は必ず用意する**（WCAG 2.5.7 Dragging Movements）。
// キーは新設せず、「表示」メニューの3項目が代替になる。

import { useRef, useState, type MouseEvent as ReactMouseEvent, type ReactElement } from 'react';
import {
  SIDEBAR_MAX_WIDTH_PX,
  SIDEBAR_MIN_WIDTH_PX,
  sidebarWidthFromPointerDelta,
} from './sidebarWidth';

export interface SidebarResizeHandleProps {
  /** 現在（確定済み）の幅。ドラッグ開始時の基準値とゴーストの初期位置に使う。 */
  width: number;
  /** ドラッグが確定したときに mouseup で1回だけ呼ばれる。 */
  onCommitWidth: (width: number) => void;
  /** メニューからの `.focus()` 用（App.tsx が参照を持つ） */
  registerRef?: (el: HTMLDivElement | null) => void;
}

interface GhostRect {
  left: number;
  top: number;
  height: number;
}

interface DragState {
  startPointerX: number;
  startWidth: number;
  sidebarTop: number;
  sidebarHeight: number;
}

const GHOST_THICKNESS_PX = 2;

export default function SidebarResizeHandle(props: SidebarResizeHandleProps): ReactElement {
  const elRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [ghost, setGhost] = useState<GhostRect | null>(null);

  const ghostFor = (drag: DragState, width: number): GhostRect => ({
    // サイドバーは常に x=0 から始まる（`.app` の最初の子）。
    left: width - GHOST_THICKNESS_PX / 2,
    top: drag.sidebarTop,
    height: drag.sidebarHeight,
  });

  const handleMouseDown = (e: ReactMouseEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    const sidebar = elRef.current?.parentElement;
    if (!sidebar) return;
    // ドラッグ開始時に1度だけ測る。以降は測り直さない（測り直すと、
    // ゴーストしか動いていないのに基準がぶれる）。
    const rect = sidebar.getBoundingClientRect();
    const drag: DragState = {
      startPointerX: e.clientX,
      startWidth: props.width,
      sidebarTop: rect.top,
      sidebarHeight: rect.height,
    };
    dragRef.current = drag;
    setGhost(ghostFor(drag, props.width));
    // ドラッグ中にターミナルのテキスト選択が走らないようにする。
    document.body.style.cursor = 'col-resize';

    const handleMove = (ev: globalThis.MouseEvent): void => {
      const current = dragRef.current;
      if (!current) return;
      const next = sidebarWidthFromPointerDelta(current.startWidth, ev.clientX - current.startPointerX);
      setGhost(ghostFor(current, next));
    };

    const finishDrag = (ev: globalThis.MouseEvent): void => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', finishDrag);
      document.body.style.cursor = '';
      const current = dragRef.current;
      dragRef.current = null;
      setGhost(null);
      if (!current) return;
      const next = sidebarWidthFromPointerDelta(current.startWidth, ev.clientX - current.startPointerX);
      // 動いていなければ何も起こさない（クリックしただけで configSet が
      // 走ると、全ウィンドウへのブロードキャスト -> 全ペインの
      // term.options.theme 再代入まで連鎖する）。
      if (next === current.startWidth) return;
      props.onCommitWidth(next);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', finishDrag);
  };

  return (
    <div
      ref={(el) => {
        elRef.current = el;
        props.registerRef?.(el);
      }}
      className="sidebar__resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="サイドバーの幅"
      aria-valuenow={props.width}
      aria-valuemin={SIDEBAR_MIN_WIDTH_PX}
      aria-valuemax={SIDEBAR_MAX_WIDTH_PX}
      aria-valuetext={`${props.width} ピクセル`}
      tabIndex={-1}
      onMouseDown={handleMouseDown}
    >
      {ghost && (
        <div
          className="sidebar__resize-ghost"
          style={{
            position: 'fixed',
            left: ghost.left,
            top: ghost.top,
            width: GHOST_THICKNESS_PX,
            height: ghost.height,
          }}
        />
      )}
    </div>
  );
}
