// スプリッタ（Issue #56 PR 7・design-review.md「提案 D'（改訂）: スプリッタ」）に
// まつわる純粋関数。ドラッグの座標計算・ARIA 文言・メニュー項目からの
// 分割比調整はすべて計算だけの小さな関数としてここに切り出し、DOM / マウス
// イベントを扱う `PaneSplitterHandle.tsx` から呼ぶ（`resizeGate.ts` や
// `paneTree.ts` の判定関数と同じ、外部に触れない部分を分離する設計に揃えた）。
//
// **`updateSplitRatio` / `clampSplitRatio`（paneTree.ts）は書き直さない。**
// ここにある関数はいずれも「ドラッグ中の見た目」や「メニューから来た調整量」を
// 計算するだけで、実際に木へ反映するときの最終的なクランプは既存の
// `paneTree.ts` 側の関数を呼び出し側（useTabs.ts）が担う。

import type { PaneRatioAdjustment } from '@shared/ipc';
import type { PanePath, SplitDirection } from './paneTree';

export type { PaneRatioAdjustment };

/**
 * ドラッグを「意図した移動」とみなす最小移動量（px）。
 *
 * スプリッタの当たり判定は 8px（design-review.md 提案 D'）で、ペインの端に
 * 対して常に ±4px ずつ食い込む。ペインの端をクリックしたつもりのユーザーは
 * 実際にはこの当たり判定に乗ってしまうため、**移動量がその半分（4px）未満の
 * mouseup は「クリック」として扱い、ペインのアクティブ化に倒す**
 * （design-review.md「ペインの端 8px がクリックのデッドゾーンになるので、
 * 移動量が閾値未満の mouseup は『その側のペインをアクティブにする』」）。
 * 半分にしているのは、当たり判定の中心から見て「まだ自分の対応するペイン領域内」
 * と言える移動量の上限がそこだから（4px を超えて動かした時点で、対応するペインの
 * 外側まで意図的に動かした＝ドラッグの意図があると判断する）。
 */
export const SPLITTER_CLICK_THRESHOLD_PX = 4;

/**
 * メニュー項目「分割比を広げる / 狭める」1回あたりの調整量。
 *
 * WCAG 2.5.7（ドラッグ動作）の Equivalent 例外の根拠になるメニュー項目
 * （design-review.md 提案 D'）。ドラッグの代替として実用的な粒度になるよう、
 * 押した回数だけ分かりやすく動く値として 5 ポイント（0.05）を採用する。
 * 実際に反映される値の最終的なクランプ（MIN_PANE_COLUMNS/ROWS 由来の下限・
 * 上限）は呼び出し側が `clampSplitRatio`（paneTree.ts）に通してから使う。
 */
export const SPLIT_RATIO_ADJUST_STEP = 0.05;

/** 木の中の経路を、DOM ref / メニュー操作の対象を引くためのキー文字列にする。 */
export function pathKey(path: PanePath): string {
  return path.join('-');
}

/**
 * `dir`（左右分割 = 'row' / 上下分割 = 'column'）から、その境界線自身の向きを返す。
 *
 * **`dir` をそのまま渡すと確実に逆になる**（design-review.md 提案 D'）。
 * 左右分割（'row'）は2つのペインを横に並べる＝境界は縦線なので `vertical`、
 * 上下分割（'column'）は境界が横線なので `horizontal`。
 */
export function splitterAriaOrientation(dir: SplitDirection): 'vertical' | 'horizontal' {
  return dir === 'row' ? 'vertical' : 'horizontal';
}

/** スプリッタの aria-label（design-review.md 提案 D' が指定する文言）。 */
export function splitterAriaLabel(dir: SplitDirection): string {
  return dir === 'row' ? '左右の分割比' : '上下の分割比';
}

/**
 * スプリッタの aria-valuetext（design-review.md 提案 D' の例: 「左 60% 右 40%」）。
 *
 * 先に一方をパーセントへ丸め、もう一方は 100 からの差分で出す
 * （両方を個別に丸めると、丸め誤差で合計が 100 にならない組み合わせが起きうる）。
 */
export function splitterValueText(dir: SplitDirection, ratio: number): string {
  const firstPercent = Math.round(ratio * 100);
  const secondPercent = 100 - firstPercent;
  return dir === 'row'
    ? `左 ${firstPercent}% 右 ${secondPercent}%`
    : `上 ${firstPercent}% 下 ${secondPercent}%`;
}

/** [0, 1] にクランプする。ドラッグ中のゴースト線の見た目だけに使う緩いクランプ
 *  （実セル寸法ベースの正式なクランプは mouseup 確定後、`clampSplitRatio` が行う）。 */
export function clampUnitRatio(ratio: number): number {
  return Math.min(1, Math.max(0, ratio));
}

/**
 * ドラッグの移動量から、プレビュー用の ratio を計算する。
 *
 * `containerExtentPx` が 0 以下（コンテナのサイズが測れていない異常時）は
 * 移動量を無視して `startRatio` をそのまま返す（0 除算による NaN を避ける）。
 */
export function ratioFromPointerDelta(
  startRatio: number,
  deltaPx: number,
  containerExtentPx: number,
): number {
  if (containerExtentPx <= 0) return startRatio;
  return clampUnitRatio(startRatio + deltaPx / containerExtentPx);
}

/**
 * 移動量未満の mouseup（クリック扱い）で、ポインタがスプリッタの中心から見て
 * どちら側にあったかを返す。当たり判定 8px の中心を 0 として、負側が最初の子
 * （'first'）、0 以上が2番目の子（'second'）。
 */
export function splitterClickSide(pointerOffsetFromCenterPx: number): 'first' | 'second' {
  return pointerOffsetFromCenterPx < 0 ? 'first' : 'second';
}

/**
 * メニュー項目「分割比を広げる / 狭める / 50% に戻す」から呼ばれる、調整後の
 * （クランプ前の）ratio を計算する。
 *
 * `ratio` は常に最初の子（children[0]）の取り分（paneTree.ts の PaneSplit 定義）
 * だが、メニュー項目が動かしたいのは**アクティブなペインの取り分**なので、
 * アクティブなペインが2番目の子（`childIndex === 1`）のときは符号を反転する
 * （「広げる」を押したのに2番目の子の取り分がまだ小さくなる、という逆操作を防ぐ）。
 */
export function adjustSplitRatioFor(
  childIndex: 0 | 1,
  currentRatio: number,
  adjustment: PaneRatioAdjustment,
  step: number = SPLIT_RATIO_ADJUST_STEP,
): number {
  if (adjustment === 'reset') return 0.5;
  const sign = adjustment === 'widen' ? 1 : -1;
  const sideSign = childIndex === 0 ? 1 : -1;
  return currentRatio + sign * sideSign * step;
}
