// useTerminal.ts の fit / resize 経路を1本化した際に切り出した純粋関数。
// 「直前と同値の cols/rows では pty.resize を送らない」を固定する
// （Issue #56 PR 0-b。将来のスプリッタ実装がドラッグ中に大量の resize を
// 飛ばさないための土台）。

import { describe, expect, it } from 'vitest';
import { shouldSendResize } from '../../src/renderer/src/terminal/resizeGate';

describe('shouldSendResize', () => {
  it('直前値が無ければ送る（初回 fit）', () => {
    expect(shouldSendResize(null, { cols: 80, rows: 24 })).toBe(true);
  });

  it('cols/rows が両方同じなら送らない', () => {
    expect(shouldSendResize({ cols: 80, rows: 24 }, { cols: 80, rows: 24 })).toBe(false);
  });

  it('cols だけ変わっていれば送る', () => {
    expect(shouldSendResize({ cols: 80, rows: 24 }, { cols: 81, rows: 24 })).toBe(true);
  });

  it('rows だけ変わっていれば送る', () => {
    expect(shouldSendResize({ cols: 80, rows: 24 }, { cols: 80, rows: 25 })).toBe(true);
  });

  it('両方変わっていれば送る', () => {
    expect(shouldSendResize({ cols: 80, rows: 24 }, { cols: 100, rows: 30 })).toBe(true);
  });
});
