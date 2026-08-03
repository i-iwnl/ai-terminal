/**
 * ウィンドウ上端のクロームの幾何（Issue #119 周5 / #20 の K-4）。
 *
 * ここは **CSS と Main プロセスの両方が同じ数値を必要とする**数少ない場所。
 *
 * - `styles.css` の `--bar-height` … `.tab-bar` の高さと `.sidebar__drag-region` の高さ
 * - `src/main/index.ts` の `trafficLightPosition` … 信号機ボタンの位置
 *
 * CSS 変数は Main プロセスから読めないので、`src/shared/defaults.ts` の `SURFACE` と
 * まったく同じ理由で**構造的に統一できない**。2箇所に置くことを認めたうえで、
 * 一致を `test/unit/css-tokens.test.ts` が機械で突き合わせる。
 *
 * **Electron には `trafficLightPosition` を読み戻す API が無い**（`getTrafficLightPosition`
 * は Electron 43 に存在しない。E2E から実測しようとして判明した）。信号機は
 * ネイティブの `NSButton` で DOM にも現れないため、**揃っていることを実行時に
 * 観測する手段が無い。** だからこそ、値の導出をここに集めて単体テストで固定する。
 */

/**
 * 信号機ボタンの実寸（1個あたり）。
 *
 * `osascript` + AppleScript-ObjC で `hiddenInset` と同じ `styleMask` の `NSWindow` を
 * 作り、`standardWindowButton` の frame を読んだ実測値
 * （`.claude/skills/design-review/reference/design-rules.md`「信号機ボタンの実測値と、
 * その測り方」）。3個とも 14x14、x の pitch は 23。
 */
export const TRAFFIC_LIGHT_SIZE_PX = 14;

/** 信号機ボタン3個の占有幅（`14 + 23 * 2 = 60`）。 */
export const TRAFFIC_LIGHT_TOTAL_WIDTH_PX = 60;

/**
 * ウィンドウ上端の帯の高さ。**`styles.css` の `--bar-height` と同じ値でなければならない。**
 *
 * `.tab-bar` と `.sidebar__drag-region` の両方がこの高さになる。
 * 周5 まで `.sidebar__drag-region` だけ 40px で、4px の段差があった（#20 の K-4）。
 */
export const BAR_HEIGHT_PX = 36;

/** 信号機ボタンの左端（ウィンドウ左端からの距離）。 */
export const TRAFFIC_LIGHT_X_PX = 16;

/**
 * 帯の高さから、信号機ボタンの `y`（**ボタンの上端**）を導く。
 *
 * Electron の `trafficLightPosition` は close ボタンの**左上**を指定するもので、
 * 光学中心ではない。`#20` が「44px にすれば光学中心 22 と合う」としていたのは
 * **二重に誤り**だった。
 *
 * 1. `{ x: 16, y: 16 }` のときの中心は `16 + 14/2 = 23`（22 ではない）
 * 2. そもそも `trafficLightPosition` は自由に動かせるので、**帯の高さを信号機に
 *    合わせる必要が無い。** 帯を先に決めて信号機をそこへ置くほうが、
 *    クロームに割くピクセルが減る（原則3「ターミナルが主役」）
 */
export function trafficLightY(barHeightPx: number): number {
  return Math.round((barHeightPx - TRAFFIC_LIGHT_SIZE_PX) / 2);
}

/** 信号機ボタンの光学中心（`y` + 半径）。帯の中心と一致しているべき値。 */
export function trafficLightCenterY(barHeightPx: number): number {
  return trafficLightY(barHeightPx) + TRAFFIC_LIGHT_SIZE_PX / 2;
}

/**
 * 信号機ボタンが占有する領域の右端。
 *
 * サイドバーを畳んだときに、この右側までタブが潜り込んでいないことを
 * `e2e/specs/S72-sidebar-collapse.spec.ts` が `document.elementFromPoint()` で確認する。
 */
export const TRAFFIC_LIGHT_RIGHT_PX = TRAFFIC_LIGHT_X_PX + TRAFFIC_LIGHT_TOTAL_WIDTH_PX;
