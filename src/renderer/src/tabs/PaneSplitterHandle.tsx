// ペインの境界に置くスプリッタ本体（Issue #56 PR 7・design-review.md
// 「提案 D'（改訂）: スプリッタ」）。
//
// **ゴースト方式。** ドラッグ中は Grid（`.pane-split__cell` の flex-grow）を
// 一切変更せず、`position: fixed` の絶対配置なゴースト線だけを動かす。
// `mouseup` で初めて確定した ratio を呼び出し側（PaneTreeView -> App.tsx ->
// useTabs.ts）へ伝え、そこで React state（tab.layout）を1回だけ更新する。
//
// これが要る理由は `useTerminal.ts` を1行も触れないという制約そのものにある。
// `.pane-split__cell` の flex-grow を実際に書き換えると、その中の
// `.terminal-pane__container` の実ピクセル寸法が変わり、`ResizeObserver` が
// 反応して `fitAddon.fit() -> pty.resize()` まで連鎖する（`useTerminal.ts` 側は
// 一切変更していないのに、ドラッグ中 1px 動くたびに `pty:resize` が飛ぶ）。
// ゴースト方式なら、実際に flex-grow が変わるのは mouseup 後の1回だけになる。
//
// `position: fixed` を使うのは、`.pane-split` に `position: relative` を足して
// 子として絶対配置するよりも、ネストした分割（深さ2以上）でも常に
// 「ドラッグ開始時に測ったコンテナの矩形」だけを基準に置けるため
// （`.terminal-stack` の `overflow: hidden` にも影響されない）。このウィンドウの
// 祖先要素に `transform` / `will-change` / `filter` を持つものは無い
// （`position: fixed` の containing block がずれる条件）ことを確認済み。
//
// **`tabIndex={-1}` を付ける（レビューで訂正）。** design-review.md には
// 「tabindex を付けない」と「メニュー項目からプログラム的に focus() する」の
// 両方が書かれており、字義どおりには両立しない（tabindex 属性が無い要素は
// `.focus()` を呼んでも何も起きない。ブラウザの仕様上、フォーカス可能な
// 要素以外への `.focus()` は no-op）。「付けない」の趣旨は「Tab キーの
// シーケンシャルナビゲーションに入れて到達可能だと ARIA で嘘をつかない」
// ことなので、**`tabindex="-1"`（シーケンシャルナビゲーションの対象外だが
// `.focus()` では到達できる）でその両方を満たす**。App.tsx 側で、メニュー
// 項目「分割比を広げる/狭める/50%に戻す」が比率を動かした対象のスプリッタへ
// `.focus()` する（ペインが3枚以上でスプリッタが複数あるとき、どちらが
// 動いたかをフォーカスリングで示すため）。

import { useRef, useState, type MouseEvent as ReactMouseEvent, type ReactElement } from 'react';
import type { SplitDirection } from './paneTree';
import { SPLITTER_CLICK_THRESHOLD_PX, ratioFromPointerDelta, splitterClickSide } from './paneSplitter';

export interface PaneSplitterHandleProps {
  dir: SplitDirection;
  /** 現在（確定済み）の ratio。ドラッグ開始時の基準値とゴーストの初期位置に使う。 */
  ratio: number;
  ariaLabel: string;
  ariaValueText: string;
  /** ドラッグが確定した（閾値以上動いた）ときに、mouseup で1回だけ呼ばれる。 */
  onCommitRatio: (ratio: number) => void;
  /**
   * 閾値未満の mouseup（クリック扱い）で呼ばれる。ペインの端 8px が
   * クリックのデッドゾーンになるため（design-review.md 提案 D'）。
   */
  onActivateSide: (side: 'first' | 'second') => void;
  /**
   * このスプリッタの DOM 要素の登録・解除（App.tsx 側の splitterRefs に対応）。
   * メニュー項目「分割比を広げる/狭める/50%に戻す」が、比率を動かした
   * **その対象のスプリッタへ `.focus()` する**ために使う（レビュー指摘。
   * ペインが3枚以上あるとスプリッタは2本以上になり、フォーカスリングが
   * 出て初めて「どちらが動いたか」が画面から分かる）。
   */
  registerRef?: (el: HTMLDivElement | null) => void;
}

interface GhostRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface DragState {
  startPointerPx: number;
  startRatio: number;
  containerRect: DOMRect;
  maxMovementPx: number;
}

/** ドラッグ開始時に測ったコンテナの矩形から、指定 ratio でのゴースト線の矩形（fixed 座標）を作る。 */
function ghostRectFor(dir: SplitDirection, containerRect: DOMRect, ratio: number): GhostRect {
  const THICKNESS_PX = 2;
  if (dir === 'row') {
    const x = containerRect.left + containerRect.width * ratio;
    return { left: x - THICKNESS_PX / 2, top: containerRect.top, width: THICKNESS_PX, height: containerRect.height };
  }
  const y = containerRect.top + containerRect.height * ratio;
  return { left: containerRect.left, top: y - THICKNESS_PX / 2, width: containerRect.width, height: THICKNESS_PX };
}

export default function PaneSplitterHandle(props: PaneSplitterHandleProps): ReactElement {
  const elRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [ghost, setGhost] = useState<GhostRect | null>(null);
  const isRow = props.dir === 'row';

  const handleMouseDown = (e: ReactMouseEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    const container = elRef.current?.parentElement;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const drag: DragState = {
      startPointerPx: isRow ? e.clientX : e.clientY,
      startRatio: props.ratio,
      containerRect,
      maxMovementPx: 0,
    };
    dragRef.current = drag;
    setGhost(ghostRectFor(props.dir, containerRect, props.ratio));

    const handleMove = (ev: globalThis.MouseEvent): void => {
      const current = dragRef.current;
      if (!current) return;
      const pointerPx = isRow ? ev.clientX : ev.clientY;
      const deltaPx = pointerPx - current.startPointerPx;
      current.maxMovementPx = Math.max(current.maxMovementPx, Math.abs(deltaPx));
      const containerExtentPx = isRow ? current.containerRect.width : current.containerRect.height;
      const previewRatio = ratioFromPointerDelta(current.startRatio, deltaPx, containerExtentPx);
      setGhost(ghostRectFor(props.dir, current.containerRect, previewRatio));
    };

    const finishDrag = (ev: globalThis.MouseEvent): void => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', finishDrag);
      const current = dragRef.current;
      dragRef.current = null;
      setGhost(null);
      if (!current) return;

      if (current.maxMovementPx < SPLITTER_CLICK_THRESHOLD_PX) {
        // クリック扱い: ペインの端 8px のデッドゾーンに乗った操作なので、
        // ratio は変えずに「押した側のペインをアクティブにする」だけ行う。
        const hitBox = elRef.current?.getBoundingClientRect();
        if (hitBox) {
          const centerPx = isRow ? hitBox.left + hitBox.width / 2 : hitBox.top + hitBox.height / 2;
          const pointerPx = isRow ? ev.clientX : ev.clientY;
          props.onActivateSide(splitterClickSide(pointerPx - centerPx));
        }
        return;
      }

      const pointerPx = isRow ? ev.clientX : ev.clientY;
      const deltaPx = pointerPx - current.startPointerPx;
      const containerExtentPx = isRow ? current.containerRect.width : current.containerRect.height;
      const finalRatio = ratioFromPointerDelta(current.startRatio, deltaPx, containerExtentPx);
      // 最終的なクランプ（実セル寸法ベースの MIN_PANE_COLUMNS/ROWS 由来の
      // 下限・上限）は呼び出し側（useTabs.ts の updateSplitRatio）が
      // `clampSplitRatio`（paneTree.ts）に通してから木へ反映する。ここでは
      // [0, 1] のゆるいクランプ済みの値をそのまま渡す。
      props.onCommitRatio(finalRatio);
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
      className={`pane-splitter pane-splitter--${props.dir}`}
      role="separator"
      aria-orientation={isRow ? 'vertical' : 'horizontal'}
      aria-label={props.ariaLabel}
      aria-valuenow={Math.round(props.ratio * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={props.ariaValueText}
      // **タブ順には入れない（Tab は xterm が端末入力として食うので、そもそも
      // 到達できても意味が無い）が、プログラム的な `.focus()` は受け付ける。**
      // `tabIndex` を完全に外す（=「付けない」を「属性そのものを持たない」の
      // 意味で読む）と `.focus()` 自体が no-op になり、メニュー項目
      // 「分割比を広げる/狭める/50%に戻す」がどのスプリッタを動かしたかを
      // フォーカスリングで示せなくなる。`-1` はシーケンシャルフォーカス
      // ナビゲーション（Tab）の対象には入らないという仕様上の保証があるため
      // （HTML 標準の tabindex="-1" の定義）、design-review.md「Tab で到達
      // できると ARIA で嘘をつかない」を破らずに、`.focus()` だけを生かせる。
      tabIndex={-1}
      onMouseDown={handleMouseDown}
    >
      {ghost && (
        <div
          className="pane-splitter__ghost"
          style={{
            position: 'fixed',
            left: ghost.left,
            top: ghost.top,
            width: ghost.width,
            height: ghost.height,
          }}
        />
      )}
    </div>
  );
}
