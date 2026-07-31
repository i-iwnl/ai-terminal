// スプリッタ（Issue #56 PR 7・design-review.md「提案 D'（改訂）: スプリッタ」）の
// 純粋関数。DOM / マウスイベントは PaneSplitterHandle.tsx（e2e S59 が担当）、
// ここでは座標計算・ARIA 文言・メニュー項目の調整量だけを固定する。

import { describe, expect, it } from 'vitest';
import {
  adjustSplitRatioFor,
  clampUnitRatio,
  pathKey,
  ratioFromPointerDelta,
  SPLIT_RATIO_ADJUST_STEP,
  SPLITTER_CLICK_THRESHOLD_PX,
  splitterAriaLabel,
  splitterAriaOrientation,
  splitterClickSide,
  splitterValueText,
} from '../../src/renderer/src/tabs/paneSplitter';

describe('splitterAriaOrientation', () => {
  it('左右分割（row）のスプリッタは縦線なので vertical', () => {
    expect(splitterAriaOrientation('row')).toBe('vertical');
  });

  it('上下分割（column）のスプリッタは横線なので horizontal（dir をそのまま渡すと逆になる）', () => {
    expect(splitterAriaOrientation('column')).toBe('horizontal');
  });
});

describe('splitterAriaLabel', () => {
  it('row は「左右の分割比」', () => {
    expect(splitterAriaLabel('row')).toBe('左右の分割比');
  });

  it('column は「上下の分割比」', () => {
    expect(splitterAriaLabel('column')).toBe('上下の分割比');
  });
});

describe('splitterValueText', () => {
  it('row: 「左 60% 右 40%」の形式になる', () => {
    expect(splitterValueText('row', 0.6)).toBe('左 60% 右 40%');
  });

  it('column: 「上 30% 下 70%」の形式になる', () => {
    expect(splitterValueText('column', 0.3)).toBe('上 30% 下 70%');
  });

  it('丸め誤差があっても両辺の合計は必ず100になる（片方だけ丸め、もう片方は差分で出す）', () => {
    // 0.005 は Math.round(0.5) の境界に近い値。両方を個別に round すると
    // 合計が 100 にならない組み合わせが起きうるため、この関数は先頭だけ丸めて
    // もう片方を差分で出す実装になっていること自体を固定する。
    const text = splitterValueText('row', 1 / 3);
    const [, leftPercent, rightPercent] = text.match(/左 (\d+)% 右 (\d+)%/) ?? [];
    expect(Number(leftPercent) + Number(rightPercent)).toBe(100);
  });
});

describe('clampUnitRatio', () => {
  it('0未満は0にクランプする', () => {
    expect(clampUnitRatio(-0.3)).toBe(0);
  });

  it('1超は1にクランプする', () => {
    expect(clampUnitRatio(1.5)).toBe(1);
  });

  it('範囲内はそのまま', () => {
    expect(clampUnitRatio(0.42)).toBe(0.42);
  });
});

describe('ratioFromPointerDelta', () => {
  it('コンテナ幅1000pxで100px動かすと ratio が0.1動く', () => {
    expect(ratioFromPointerDelta(0.5, 100, 1000)).toBeCloseTo(0.6, 10);
  });

  it('負の方向にも動く', () => {
    expect(ratioFromPointerDelta(0.5, -200, 1000)).toBeCloseTo(0.3, 10);
  });

  it('[0,1] を超える移動は緩くクランプする（最終的な下限/上限は clampSplitRatio が別途行う）', () => {
    expect(ratioFromPointerDelta(0.5, 10_000, 1000)).toBe(1);
    expect(ratioFromPointerDelta(0.5, -10_000, 1000)).toBe(0);
  });

  it('コンテナ幅が0以下（測れていない異常時）は移動量を無視して startRatio をそのまま返す', () => {
    expect(ratioFromPointerDelta(0.42, 100, 0)).toBe(0.42);
    expect(ratioFromPointerDelta(0.42, 100, -5)).toBe(0.42);
  });
});

describe('splitterClickSide', () => {
  it('中心より前（負）は first', () => {
    expect(splitterClickSide(-3)).toBe('first');
  });

  it('中心（0）は second側に倒す', () => {
    expect(splitterClickSide(0)).toBe('second');
  });

  it('中心より後（正）は second', () => {
    expect(splitterClickSide(3)).toBe('second');
  });
});

describe('pathKey', () => {
  it('ルート（空配列）は空文字になる', () => {
    expect(pathKey([])).toBe('');
  });

  it('経路をハイフン区切りにする', () => {
    expect(pathKey([0, 1, 0])).toBe('0-1-0');
  });

  it('異なる経路は異なるキーになる（Map のキー衝突が起きない）', () => {
    expect(pathKey([0, 1])).not.toBe(pathKey([1, 0]));
  });
});

describe('adjustSplitRatioFor', () => {
  it('reset は childIndex に関わらず常に0.5', () => {
    expect(adjustSplitRatioFor(0, 0.8, 'reset')).toBe(0.5);
    expect(adjustSplitRatioFor(1, 0.2, 'reset')).toBe(0.5);
  });

  it('アクティブなペインが最初の子（childIndex 0）: widen は ratio を増やす', () => {
    expect(adjustSplitRatioFor(0, 0.5, 'widen')).toBeCloseTo(0.5 + SPLIT_RATIO_ADJUST_STEP, 10);
  });

  it('アクティブなペインが最初の子（childIndex 0）: narrow は ratio を減らす', () => {
    expect(adjustSplitRatioFor(0, 0.5, 'narrow')).toBeCloseTo(0.5 - SPLIT_RATIO_ADJUST_STEP, 10);
  });

  it('アクティブなペインが2番目の子（childIndex 1）: widen はそのペインの取り分（1-ratio）を増やすため ratio を減らす', () => {
    // 2番目の子の取り分は (1 - ratio)。それを広げるには ratio を下げる必要がある
    // （「広げる」を押したのに2番目の子がまだ縮む、という逆操作を防ぐ本体）。
    expect(adjustSplitRatioFor(1, 0.5, 'widen')).toBeCloseTo(0.5 - SPLIT_RATIO_ADJUST_STEP, 10);
  });

  it('アクティブなペインが2番目の子（childIndex 1）: narrow は ratio を増やす', () => {
    expect(adjustSplitRatioFor(1, 0.5, 'narrow')).toBeCloseTo(0.5 + SPLIT_RATIO_ADJUST_STEP, 10);
  });

  it('step を明示的に渡せる', () => {
    expect(adjustSplitRatioFor(0, 0.5, 'widen', 0.2)).toBeCloseTo(0.7, 10);
  });
});

// SPLITTER_CLICK_THRESHOLD_PX 自体の値を固定する。PaneSplitterHandle.tsx の
// e2e（S59）はこの値を直接は読まないが（実際のマウス移動量で判定する）、
// 「4px」という具体的な数字がここに1箇所だけ存在することを保証しておく
// （2箇所に散ると片方だけ変えて閾値がずれる事故につながるため）。
describe('SPLITTER_CLICK_THRESHOLD_PX', () => {
  it('当たり判定8pxの半分の4pxである', () => {
    expect(SPLITTER_CLICK_THRESHOLD_PX).toBe(4);
  });
});
