// ウィンドウ状態の永続化（Issue #119 周5 / #20 の K-9）の純粋関数。
//
// `BrowserWindow` の実挙動（保存・復元）は E2E でもプロセスを跨げないので
// 検証できない（#15 と同じ制約）。**判定だけを切り出して直接固定する。**

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WINDOW_SIZE,
  coerceWindowState,
  isVisibleOnSomeDisplay,
} from '../../src/main/window-state';

describe('coerceWindowState（外部 JSON の取り込み）', () => {
  // CLAUDE.md 鉄則5: 外部フォーカスのパース失敗でアプリを落とさない。

  it('壊れた入力は既定へ落とす', () => {
    for (const bad of [null, undefined, 'x', 42, []]) {
      const state = coerceWindowState(bad);
      expect(state.width).toBe(DEFAULT_WINDOW_SIZE.width);
      expect(state.height).toBe(DEFAULT_WINDOW_SIZE.height);
      expect(state.fullScreen).toBe(false);
    }
  });

  it('正常な値はそのまま通す', () => {
    const state = coerceWindowState({ x: 100, y: 50, width: 900, height: 700, fullScreen: true });
    expect(state).toEqual({ x: 100, y: 50, width: 900, height: 700, fullScreen: true });
  });

  it('幅・高さが BrowserWindow の最小値を下回らない', () => {
    // **下回ると「開いた瞬間に何も操作できないウィンドウ」になる。**
    // minWidth: 640 / minHeight: 400（src/main/index.ts）。
    const state = coerceWindowState({ width: 10, height: 10 });
    expect(state.width).toBe(640);
    expect(state.height).toBe(400);
  });

  it('数値でない値・NaN・Infinity は既定へ落とす', () => {
    const state = coerceWindowState({
      x: 'left',
      y: Number.NaN,
      width: Number.POSITIVE_INFINITY,
      height: null,
      fullScreen: 'yes',
    });
    expect(state.x).toBeUndefined();
    expect(state.y).toBeUndefined();
    expect(state.width).toBe(DEFAULT_WINDOW_SIZE.width);
    expect(state.height).toBe(DEFAULT_WINDOW_SIZE.height);
    // 文字列の 'yes' は真偽値ではないので false 側に倒す
    // （**壊れた値で勝手にフルスクリーンにしない**）。
    expect(state.fullScreen).toBe(false);
  });
});

describe('isVisibleOnSomeDisplay（画面外に開かない）', () => {
  // **外部ディスプレイを外したあとに起動すると、ウィンドウが画面外に出て
  // 二度と掴めなくなる。** 位置だけ捨てて中央配置へ落とすための判定。

  const primary = { bounds: { x: 0, y: 0, width: 1512, height: 982 } };
  const external = { bounds: { x: 1512, y: 0, width: 2560, height: 1440 } };

  it('位置が保存されていなければ「見えていない」', () => {
    expect(
      isVisibleOnSomeDisplay({ width: 1200, height: 800, fullScreen: false }, [primary]),
    ).toBe(false);
  });

  it('主ディスプレイの中なら見えている', () => {
    expect(
      isVisibleOnSomeDisplay({ x: 100, y: 100, width: 1200, height: 800, fullScreen: false }, [
        primary,
      ]),
    ).toBe(true);
  });

  it('外部ディスプレイを外すと見えなくなる', () => {
    const onExternal = { x: 2000, y: 200, width: 1200, height: 800, fullScreen: false };
    expect(isVisibleOnSomeDisplay(onExternal, [primary, external])).toBe(true);
    // 外したあと
    expect(isVisibleOnSomeDisplay(onExternal, [primary])).toBe(false);
  });

  it('端が少しだけ掛かっている程度では「見えている」と認めない', () => {
    // タイトルバーを掴める程度（横 100px / 縦 50px）の重なりを要求する。
    const barelyRight = { x: 1462, y: 100, width: 1200, height: 800, fullScreen: false };
    expect(isVisibleOnSomeDisplay(barelyRight, [primary])).toBe(false);
    const barelyBottom = { x: 100, y: 950, width: 1200, height: 800, fullScreen: false };
    expect(isVisibleOnSomeDisplay(barelyBottom, [primary])).toBe(false);
  });

  it('負の座標（主ディスプレイの左・上に置いたディスプレイ）でも判定できる', () => {
    const left = { bounds: { x: -1920, y: -200, width: 1920, height: 1080 } };
    expect(
      isVisibleOnSomeDisplay({ x: -1800, y: 0, width: 1200, height: 800, fullScreen: false }, [
        primary,
        left,
      ]),
    ).toBe(true);
  });
});
