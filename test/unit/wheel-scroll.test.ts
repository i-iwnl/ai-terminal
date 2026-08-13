// 代替画面バッファでのホイール -> 矢印キー変換の固定（`src/renderer/src/terminal/wheelScroll.ts`）。
//
// **このファイルの主目的は「1イベント = 矢印1個」への逆戻りを検出すること。**
// xterm.js 6.0.0 の既定がまさにそれで、AI タブ（常に tmux ラップ = 代替画面）の
// スクロールが1行ずつしか進まない原因だった。`consumeWheelScroll` を消して
// xterm 既定へ戻すと「マウスホイール1ノッチ」のテストが 5 -> 1 で落ちる。
//
// 物理量（deltaMode の3種・トラックパッド判定・端数の繰り越し）は Playwright から
// 作り分けられないので、網羅はここが唯一の正。

import { describe, expect, it } from 'vitest';
import {
  DELTA_MODE_LINE,
  DELTA_MODE_PAGE,
  DELTA_MODE_PIXEL,
  arrowScrollSequence,
  consumeWheelScroll,
  shouldConvertWheelToArrows,
  type MouseTrackingMode,
  type WheelGeometry,
  type WheelInput,
} from '../../src/renderer/src/terminal/wheelScroll';

/** 実測に近い幾何（fontSize 13 前後で行高 17px、24行）。 */
const GEOMETRY: WheelGeometry = { cellHeightCssPx: 17, rows: 24 };

function wheel(overrides: Partial<WheelInput> = {}): WheelInput {
  return {
    deltaY: 0,
    deltaMode: DELTA_MODE_PIXEL,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    ...overrides,
  };
}

describe('shouldConvertWheelToArrows', () => {
  // xterm の `Terminal.modes.mouseTrackingMode` が取りうる値の全列挙。
  // 増えたらここで型エラーになるので、新しいモードを黙って取りこぼさない。
  const ALL_MODES: readonly MouseTrackingMode[] = ['none', 'x10', 'vt200', 'drag', 'any'];

  describe('マウス報告がホイールを含むモード（Issue #251 の本体）', () => {
    // ⭐ ここが緩むと、矢印を送るだけでなく**マウス報告そのものを握り潰す**。
    // claude / gemini は起動時に必ず `?1000h ?1002h ?1003h ?1006h` を出すので、
    // AI タブのホイールが CLI に一切届かなくなる（CLI 側は矢印の連打を
    // arrow-burst と判定して「use PgUp/PgDn to scroll」を出す）。
    it.each(['vt200', 'drag', 'any'] as const)('%s では介入しない', (mode) => {
      expect(shouldConvertWheelToArrows('alternate', mode)).toBe(false);
    });
  });

  describe('マウス報告がホイールを含まないモード（#238 の改善を残す）', () => {
    // `x10` の events は DOWN だけ。ここまで除外すると xterm 既定の「矢印1個」に
    // 落ちて、#238 が直した「1ノッチ1行しか進まない」へ逆戻りする。
    it.each(['none', 'x10'] as const)('%s では代替画面バッファで変換する', (mode) => {
      expect(shouldConvertWheelToArrows('alternate', mode)).toBe(true);
    });
  });

  describe('通常バッファ', () => {
    it.each(ALL_MODES)('%s でも、どのモードでも介入しない', (mode) => {
      expect(shouldConvertWheelToArrows('normal', mode)).toBe(false);
    });
  });

  it('変換するのは「代替画面 かつ ホイールを含まないモード」の組み合わせだけ', () => {
    const converting = ALL_MODES.flatMap((mode) =>
      (['normal', 'alternate'] as const)
        .filter((buffer) => shouldConvertWheelToArrows(buffer, mode))
        .map((buffer) => `${buffer}/${mode}`),
    );
    expect(converting.sort()).toEqual(['alternate/none', 'alternate/x10']);
  });
});

describe('consumeWheelScroll', () => {
  describe('マウスホイール（DOM_DELTA_PIXEL・減衰なし）', () => {
    it('1ノッチで複数行進む（xterm 既定の「矢印1個」への逆戻りを検出する）', () => {
      // 100px / 17px = 5.88 行。トラックパッド閾値 50 以上なので減衰しない。
      const result = consumeWheelScroll(wheel({ deltaY: 100 }), GEOMETRY, 0);
      expect(result.lines).toBe(5);
      expect(result.lines).toBeGreaterThan(1); // ← 退化したら必ずここで落ちる
      expect(result.carry).toBeCloseTo(0.882, 3);
    });

    it('上向きは負の行数になる', () => {
      expect(consumeWheelScroll(wheel({ deltaY: -100 }), GEOMETRY, 0).lines).toBe(-5);
    });

    it('繰り越した端数が次のイベントで消化される', () => {
      const first = consumeWheelScroll(wheel({ deltaY: 100 }), GEOMETRY, 0);
      const second = consumeWheelScroll(wheel({ deltaY: 100 }), GEOMETRY, first.carry);
      // 5.88 + 5.88 = 11.76 -> 1回目で 5、2回目は繰り越し 0.88 を足して 6。
      expect(second.lines).toBe(6);
      expect(first.lines + second.lines).toBe(11);
    });

    it('行高が大きいほど進む行数は減る', () => {
      const tall = consumeWheelScroll(wheel({ deltaY: 100 }), { cellHeightCssPx: 34, rows: 24 }, 0);
      expect(tall.lines).toBe(2);
    });
  });

  describe('トラックパッド（|deltaY| < 50 で減衰する）', () => {
    it('1イベントでは1行にも満たず、端数として繰り越される', () => {
      // 12 / 17 * 0.3 = 0.21 行。
      const result = consumeWheelScroll(wheel({ deltaY: 12 }), GEOMETRY, 0);
      expect(result.lines).toBe(0);
      expect(result.carry).toBeCloseTo(0.212, 3);
    });

    it('積み重なれば1行進む（端数を捨てていたら永久に動かない）', () => {
      let carry = 0;
      let total = 0;
      for (let i = 0; i < 5; i += 1) {
        const result = consumeWheelScroll(wheel({ deltaY: 12 }), GEOMETRY, carry);
        carry = result.carry;
        total += result.lines;
      }
      expect(total).toBe(1);
    });

    it('減衰が効いている（同じ deltaY をマウス扱いしたときより遅い）', () => {
      // 60px はトラックパッド閾値 50 を超えるので減衰しない = 3行。
      // 49px は減衰する = 0.86 行で、行数は 0。
      expect(consumeWheelScroll(wheel({ deltaY: 60 }), GEOMETRY, 0).lines).toBe(3);
      expect(consumeWheelScroll(wheel({ deltaY: 49 }), GEOMETRY, 0).lines).toBe(0);
    });
  });

  describe('deltaMode', () => {
    it('DOM_DELTA_LINE は換算せずそのまま行数として扱う', () => {
      expect(consumeWheelScroll(wheel({ deltaY: 3, deltaMode: DELTA_MODE_LINE }), GEOMETRY, 0).lines).toBe(3);
    });

    it('DOM_DELTA_LINE では端数を繰り越さない（もともと整数の行数のため）', () => {
      const result = consumeWheelScroll(wheel({ deltaY: 3, deltaMode: DELTA_MODE_LINE }), GEOMETRY, 0.9);
      expect(result.carry).toBe(0.9);
    });

    it('DOM_DELTA_PAGE は1画面ぶん進む', () => {
      expect(consumeWheelScroll(wheel({ deltaY: 1, deltaMode: DELTA_MODE_PAGE }), GEOMETRY, 0).lines).toBe(24);
    });
  });

  describe('修飾キー', () => {
    it('Alt で倍速になる', () => {
      // 100 / 17 * 5 = 29.4 行 -> 上限 24 行にかかる。
      expect(consumeWheelScroll(wheel({ deltaY: 100, altKey: true }), GEOMETRY, 0).lines).toBe(24);
      // 上限にかからない量で倍率そのものを見る（60 / 17 = 3.5 行が 5 倍で 17.6 行）。
      expect(consumeWheelScroll(wheel({ deltaY: 60 }), GEOMETRY, 0).lines).toBe(3);
      expect(consumeWheelScroll(wheel({ deltaY: 60, altKey: true }), GEOMETRY, 0).lines).toBe(17);
    });

    it('Ctrl でも倍速になる', () => {
      expect(consumeWheelScroll(wheel({ deltaY: 60, ctrlKey: true }), GEOMETRY, 0).lines).toBe(17);
    });

    it('倍速はトラックパッドの減衰より先に効く（減衰域でも5倍のまま）', () => {
      // 12 / 17 * 0.3 = 0.21 行。Alt を足すと 1.06 行になり、1行ぶん進む。
      expect(consumeWheelScroll(wheel({ deltaY: 12 }), GEOMETRY, 0).lines).toBe(0);
      expect(consumeWheelScroll(wheel({ deltaY: 12, altKey: true }), GEOMETRY, 0).lines).toBe(1);
    });

    it('Shift は横スクロールなので1行も送らない', () => {
      expect(consumeWheelScroll(wheel({ deltaY: 100, shiftKey: true }), GEOMETRY, 0).lines).toBe(0);
    });

    it('Shift のとき繰り越しを壊さない', () => {
      expect(consumeWheelScroll(wheel({ deltaY: 100, shiftKey: true }), GEOMETRY, 0.4).carry).toBe(0.4);
    });
  });

  describe('上限', () => {
    it('1イベントで画面の行数を超えて送らない', () => {
      expect(consumeWheelScroll(wheel({ deltaY: 100000 }), GEOMETRY, 0).lines).toBe(24);
      expect(consumeWheelScroll(wheel({ deltaY: -100000 }), GEOMETRY, 0).lines).toBe(-24);
    });

    it('行数が小さい端末では上限もそれに従う', () => {
      const tiny: WheelGeometry = { cellHeightCssPx: 17, rows: 3 };
      expect(consumeWheelScroll(wheel({ deltaY: 100000 }), tiny, 0).lines).toBe(3);
    });
  });

  describe('縮退（落とさずに0行を返す）', () => {
    it('縦の移動が無ければ送らない', () => {
      expect(consumeWheelScroll(wheel({ deltaY: 0 }), GEOMETRY, 0).lines).toBe(0);
    });

    it('行高が 0（マウント直後・非表示ペイン）なら送らない', () => {
      expect(consumeWheelScroll(wheel({ deltaY: 100 }), { cellHeightCssPx: 0, rows: 24 }, 0).lines).toBe(0);
    });

    it('行高が NaN でも送らない', () => {
      expect(consumeWheelScroll(wheel({ deltaY: 100 }), { cellHeightCssPx: NaN, rows: 24 }, 0).lines).toBe(0);
    });

    it('deltaY が NaN でも送らない', () => {
      expect(consumeWheelScroll(wheel({ deltaY: NaN }), GEOMETRY, 0).lines).toBe(0);
    });

    it('繰り越しが NaN でも 0 から立て直す', () => {
      const result = consumeWheelScroll(wheel({ deltaY: 100 }), GEOMETRY, NaN);
      expect(result.lines).toBe(5);
      expect(Number.isFinite(result.carry)).toBe(true);
    });

    it('rows が 0 でも上限 1 行に縮退して落ちない', () => {
      const result = consumeWheelScroll(wheel({ deltaY: 100 }), { cellHeightCssPx: 17, rows: 0 }, 0);
      expect(result.lines).toBe(1);
    });
  });
});

describe('arrowScrollSequence', () => {
  it('下向きは行数ぶんの CSI B を返す', () => {
    expect(arrowScrollSequence(3, false)).toBe('\x1b[B\x1b[B\x1b[B');
  });

  it('上向きは行数ぶんの CSI A を返す', () => {
    expect(arrowScrollSequence(-2, false)).toBe('\x1b[A\x1b[A');
  });

  it('applicationCursorKeys（DECCKM）なら SS3 の形になる', () => {
    expect(arrowScrollSequence(2, true)).toBe('\x1bOB\x1bOB');
    expect(arrowScrollSequence(-1, true)).toBe('\x1bOA');
  });

  it('0 行なら何も送らない', () => {
    expect(arrowScrollSequence(0, false)).toBe('');
    expect(arrowScrollSequence(0, true)).toBe('');
  });

  it('整数でなければ何も送らない（誤って端数を渡したときに暴発させない）', () => {
    expect(arrowScrollSequence(1.5, false)).toBe('');
    expect(arrowScrollSequence(NaN, false)).toBe('');
  });

  it('本数が行数と1対1で対応する（1個しか送らない実装への逆戻りを検出する）', () => {
    const sequence = arrowScrollSequence(5, false);
    expect(sequence.split('\x1b').length - 1).toBe(5);
  });
});
