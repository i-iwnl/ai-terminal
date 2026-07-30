// pty.resize を送るべきかどうかの純粋な判定。
//
// fit() のたびに無条件で IPC を飛ばすと、cols/rows が変わっていなくても
// 子プロセスに SIGWINCH が届く。将来スプリッタ（Issue #56 PR 7）でドラッグ中に
// ResizeObserver が高頻度発火したとき、実際に値が変わった回だけに絞るための土台。
//
// 呼び出し側（useTerminal）は直前値を**インスタンススコープの ref**で持つこと。
// モジュールスコープの変数に置くと、ペインが複数になったときに全ペインで
// 1つの直前値を奪い合って壊れる。

export interface ResizeDims {
  cols: number;
  rows: number;
}

/** 直前に送った値（未送信なら null）と次の値を比べ、送るべきかどうかを返す。 */
export function shouldSendResize(previous: ResizeDims | null, next: ResizeDims): boolean {
  if (previous === null) return true;
  return previous.cols !== next.cols || previous.rows !== next.rows;
}
