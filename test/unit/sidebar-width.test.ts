// サイドバーの幅の判定（Issue #119 周4 / #20 の PR 16）。
//
// ドラッグの結果は「幅が変わった」という観測しにくい出力にしかならないので、
// 判定だけを純粋関数として直接固定する。

import { describe, expect, it } from 'vitest';

import {
  SIDEBAR_DEFAULT_WIDTH_PX,
  SIDEBAR_MAX_WIDTH_PX,
  SIDEBAR_MIN_WIDTH_PX,
  SIDEBAR_WIDTH_STEP_PX,
  clampSidebarWidth,
  sidebarWidthFromPointerDelta,
  stepSidebarWidth,
} from '../../src/renderer/src/sidebar/sidebarWidth';

/**
 * 信号機ボタンの占有領域の右端（実測）。
 *
 * AppKit の `standardWindowButton` は 14x14 / pitch 23、Electron の
 * `trafficLightPosition: { x: 16, y: 16 }` から占有は x:16〜76。
 * `design-rules.md` の「信号機ボタンの実測値と、その測り方」が正。
 */
const TRAFFIC_LIGHT_RIGHT_PX = 76;

describe('サイドバー幅のクランプ', () => {
  it('下限が信号機ボタンの右端より十分上にある', () => {
    // **これが下回ると、design-rules が却下した「44px のレール」の構図が再現する**
    // （信号機がサイドバーをはみ出してターミナル領域に乗る）。
    // 幅0にしたいときはドラッグではなく折りたたみ（Opt+Cmd+S）を使う。
    expect(SIDEBAR_MIN_WIDTH_PX).toBeGreaterThan(TRAFFIC_LIGHT_RIGHT_PX);
    // 余裕が数 px しかない、という状態にもしない。
    expect(SIDEBAR_MIN_WIDTH_PX - TRAFFIC_LIGHT_RIGHT_PX).toBeGreaterThanOrEqual(100);
  });

  it('既定幅が許容範囲の中にある', () => {
    expect(SIDEBAR_DEFAULT_WIDTH_PX).toBeGreaterThanOrEqual(SIDEBAR_MIN_WIDTH_PX);
    expect(SIDEBAR_DEFAULT_WIDTH_PX).toBeLessThanOrEqual(SIDEBAR_MAX_WIDTH_PX);
  });

  it('範囲内の値はそのまま返す', () => {
    expect(clampSidebarWidth(260)).toBe(260);
    expect(clampSidebarWidth(SIDEBAR_MIN_WIDTH_PX)).toBe(SIDEBAR_MIN_WIDTH_PX);
    expect(clampSidebarWidth(SIDEBAR_MAX_WIDTH_PX)).toBe(SIDEBAR_MAX_WIDTH_PX);
  });

  it('範囲外は端へ丸める', () => {
    expect(clampSidebarWidth(0)).toBe(SIDEBAR_MIN_WIDTH_PX);
    expect(clampSidebarWidth(-500)).toBe(SIDEBAR_MIN_WIDTH_PX);
    expect(clampSidebarWidth(10_000)).toBe(SIDEBAR_MAX_WIDTH_PX);
  });

  it('小数は整数へ丸める', () => {
    // インラインの CSS カスタムプロパティへ渡す値なので、小数のままだと
    // 実測系の spec（getBoundingClientRect）が桁で揺れる。
    expect(clampSidebarWidth(260.4)).toBe(260);
    expect(clampSidebarWidth(260.6)).toBe(261);
  });

  it('有限でない値は既定幅へ落とす（config.json 由来の値がそのまま来る経路がある）', () => {
    // CLAUDE.md 鉄則5: 外部由来の値のパース失敗でアプリを落とさない。
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_DEFAULT_WIDTH_PX);
    expect(clampSidebarWidth(Number.POSITIVE_INFINITY)).toBe(SIDEBAR_DEFAULT_WIDTH_PX);
    expect(clampSidebarWidth(Number.NEGATIVE_INFINITY)).toBe(SIDEBAR_DEFAULT_WIDTH_PX);
  });
});

describe('ドラッグからの幅', () => {
  it('右へ動かすと広がり、左へ動かすと狭まる', () => {
    // ハンドルはサイドバーの右端にある。
    expect(sidebarWidthFromPointerDelta(260, 40)).toBe(300);
    expect(sidebarWidthFromPointerDelta(260, -40)).toBe(220);
  });

  it('動かしていなければ幅は変わらない', () => {
    expect(sidebarWidthFromPointerDelta(300, 0)).toBe(300);
  });

  it('端を超えて動かしてもクランプされる', () => {
    expect(sidebarWidthFromPointerDelta(260, -1000)).toBe(SIDEBAR_MIN_WIDTH_PX);
    expect(sidebarWidthFromPointerDelta(260, 1000)).toBe(SIDEBAR_MAX_WIDTH_PX);
  });
});

describe('メニューからの増減（ドラッグのキーボード代替）', () => {
  // WCAG 2.5.7 Dragging Movements。ドラッグ以外の手段を必ず用意する。
  // キーは新設しない（`menu.ts` の `分割比を広げる / 狭める / 50%に戻す` が
  // `accelerator: undefined` の前例。幅調整は頻度が低く、Cmd+英数字 の
  // 名前空間は 100手/日級の操作のために空けておく）。

  it('1段階ずつ広がる / 狭まる', () => {
    expect(stepSidebarWidth(260, 'wider')).toBe(260 + SIDEBAR_WIDTH_STEP_PX);
    expect(stepSidebarWidth(260, 'narrower')).toBe(260 - SIDEBAR_WIDTH_STEP_PX);
  });

  it('端では止まる（押し続けても範囲外へ出ない）', () => {
    expect(stepSidebarWidth(SIDEBAR_MAX_WIDTH_PX, 'wider')).toBe(SIDEBAR_MAX_WIDTH_PX);
    expect(stepSidebarWidth(SIDEBAR_MIN_WIDTH_PX, 'narrower')).toBe(SIDEBAR_MIN_WIDTH_PX);
  });

  it('端の手前からでも範囲を超えない', () => {
    expect(stepSidebarWidth(SIDEBAR_MAX_WIDTH_PX - 5, 'wider')).toBe(SIDEBAR_MAX_WIDTH_PX);
    expect(stepSidebarWidth(SIDEBAR_MIN_WIDTH_PX + 5, 'narrower')).toBe(SIDEBAR_MIN_WIDTH_PX);
  });
});
