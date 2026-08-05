// ウィンドウ状態の永続化（Issue #119 周5 / #20 の K-9 / #153）の純粋関数。
//
// **本体ウィンドウ**の保存・復元は E2E でもプロセスを跨げないので検証できない
// （#15 と同じ制約。復元を見るには再起動が要る）。判定だけを切り出して直接固定する。
//
// ⚠ **設定ウィンドウは事情が違う。** 開くたびに `BrowserWindow` を作り直すので、
// 同じプロセスの中で「動かす -> 閉じる -> 開き直す」を通せる。**そちらは
// `e2e/specs/S98-settings-window-state.spec.ts` が実挙動で固定している。**
// ここが押さえるのは、外部 JSON の取り込みと後方互換だけ。

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SETTINGS_WINDOW_HEIGHT,
  DEFAULT_WINDOW_SIZE,
  coerceSettingsWindowState,
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

describe('coerceSettingsWindowState（設定ウィンドウ。Issue #153）', () => {
  // 保存先は本体と同じ `window-state.json` で、`settings` キーに相乗りする。
  // **既存のファイルにはこのキーが無い**ので、無い場合が既定の入口になる。

  it('キーが無い（既存の window-state.json）なら既定の高さに落とす', () => {
    // 後方互換の本体。ここが落ちると、更新した瞬間に設定ウィンドウが開かなくなる。
    for (const missing of [undefined, null, 'x', 42, []]) {
      expect(coerceSettingsWindowState(missing).height).toBe(DEFAULT_SETTINGS_WINDOW_HEIGHT);
      expect(coerceSettingsWindowState(missing).x).toBeUndefined();
      expect(coerceSettingsWindowState(missing).y).toBeUndefined();
    }
  });

  it('正常な値はそのまま通す', () => {
    expect(coerceSettingsWindowState({ x: 317, y: 211, height: 701 })).toEqual({
      x: 317,
      y: 211,
      height: 701,
    });
  });

  it('横幅は取り込まない（minWidth === maxWidth === 520 で仕様として固定）', () => {
    const state = coerceSettingsWindowState({ x: 1, y: 2, width: 999, height: 640 });
    expect(state).toEqual({ x: 1, y: 2, height: 640 });
    expect('width' in state).toBe(false);
  });

  it('minHeight（360）を下回る高さは採らない', () => {
    // 下回ると「開いた瞬間に何も操作できないウィンドウ」になる。
    expect(coerceSettingsWindowState({ height: 10 }).height).toBe(360);
    expect(coerceSettingsWindowState({ height: 360 }).height).toBe(360);
    expect(coerceSettingsWindowState({ height: 361 }).height).toBe(361);
  });

  it('数値でない座標・高さは捨てる（鉄則5）', () => {
    const state = coerceSettingsWindowState({ x: '317', y: null, height: Number.NaN });
    expect(state.x).toBeUndefined();
    expect(state.y).toBeUndefined();
    expect(state.height).toBe(DEFAULT_SETTINGS_WINDOW_HEIGHT);
  });
});
