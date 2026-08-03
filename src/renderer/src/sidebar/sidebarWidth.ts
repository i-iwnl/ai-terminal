/**
 * サイドバーの幅の判定（Issue #119 周4 / #20 の PR 16）。
 *
 * **純粋関数に切り出してある。** ドラッグの結果は「幅が変わった」という
 * 観測しにくい出力にしかならないので、判定だけを直接固定できる形にする
 * （このリポジトリには `shouldSendResize` / `computeYourTurnSince` /
 * `rovingTabindex` / `passesModifierGate` / `paneTree` / `paneHeader` /
 * `paneSplitter` / `chromeTextRemainsReadable` と前例が8つある）。
 */

/**
 * 下限。**信号機ボタンの実測右端（x=76）より十分上に置くこと。**
 *
 * `design-rules.md` の却下済み一覧にある「サイドバーを 44px のレールに畳む」は、
 * 信号機ボタン（AppKit の standardWindowButton は 14x14 / pitch 23、Electron の
 * `trafficLightPosition: {x:16, y:16}` から占有は x:16〜76）が**レールをはみ出して
 * ターミナル領域に乗る**という理由で却下されている。
 * ドラッグの下限をそこまで下げると、却下したのと同じ構図が再現する。
 *
 * 値は現行の CSS（`.sidebar { min-width: 220px }`）を据え置いたもの。
 * **幅を 0 にしたいときはドラッグではなく折りたたみ（`Opt+Cmd+S`）を使う。**
 * 折りたたみは `.sidebar.is-collapsed` が別経路で担当しており、
 * そちらは信号機の逃げ帯（`.tab-bar__traffic-light-gap`）とセットになっている。
 */
export const SIDEBAR_MIN_WIDTH_PX = 220;

/**
 * 上限。現行の CSS（`max-width: 340px`）より広げてある。
 *
 * 340px はドラッグできなかった頃の「これ以上は要らないだろう」という値で、
 * 実際に掴んで動かせるようになると窮屈になる。原則3「ターミナルが主役」は
 * **既定値**（260px）で守るものであって、利用者が自分で広げる上限を
 * 絞る理由にはならない。
 */
export const SIDEBAR_MAX_WIDTH_PX = 420;

/** 既定幅。`src/shared/defaults.ts` の `DEFAULT_CONFIG.sidebarWidth` と一致させること。 */
export const SIDEBAR_DEFAULT_WIDTH_PX = 260;

/** 「表示」メニューの `サイドバーを広げる / 狭める` の1回あたりの変化量。 */
export const SIDEBAR_WIDTH_STEP_PX = 20;

/**
 * 幅を許容範囲へ丸める。
 *
 * 有限でない値（NaN / Infinity）は既定幅へ落とす。**外部由来の値
 * （`config.json`）がそのまま流れてくる経路があるので、ここで落とさない**
 * （CLAUDE.md 鉄則5: パース失敗でアプリを落とさない）。
 */
export function clampSidebarWidth(px: number): number {
  if (!Number.isFinite(px)) return SIDEBAR_DEFAULT_WIDTH_PX;
  return Math.round(Math.min(SIDEBAR_MAX_WIDTH_PX, Math.max(SIDEBAR_MIN_WIDTH_PX, px)));
}

/**
 * ドラッグ開始時の幅とポインタの移動量から、次の幅を求める。
 * ハンドルはサイドバーの右端にあるので、右へ動かすと広がる。
 */
export function sidebarWidthFromPointerDelta(startWidthPx: number, deltaPx: number): number {
  return clampSidebarWidth(startWidthPx + deltaPx);
}

/** 「表示」メニューからの1段階の増減。 */
export function stepSidebarWidth(currentPx: number, direction: 'wider' | 'narrower'): number {
  const delta = direction === 'wider' ? SIDEBAR_WIDTH_STEP_PX : -SIDEBAR_WIDTH_STEP_PX;
  return clampSidebarWidth(currentPx + delta);
}
