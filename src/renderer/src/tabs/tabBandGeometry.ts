/**
 * タブ上端に積む2本の帯（プロバイダの色相アクセントと、フォーカスリング）の幾何。
 *
 * **なぜ導出をここに集めるか。**
 *
 * Issue #165 後半で分かったこと: プロバイダの帯を「面から見えるように」明るくすると、
 * **真下に接するフォーカスリング（白）との差が消える**。しかもこの2つの要求は
 * 同時には満たせない（対 `#525252` で 3:1 には相対輝度 >= 0.3531、対 `#ffffff` で
 * 3:1 には <= 0.3000。**区間が交わらないので 24bit の全色に解が無い**）。
 *
 * 逃げ道は色ではなく**幾何**にある。リングを 2px 内側へずらして帯との間に面を挟めば、
 * 「隣接色」ではなくなるので制約が外れる。
 *
 * ⛔ **その担保を `expect(getComputedStyle(el).outlineOffset).toBe('-4px')` で書かない。**
 * それは CSS の宣言を言い換えただけで、`contrast.ts` の冒頭が
 * 「宣言値ではなくブラウザが解決した実効値を見る」と言って捨てた形と同型。
 * **実際に何 px 空いているか**を計算して見ること。
 *
 * **符号と向きが間違えやすいので、そこをこのファイルに閉じて単体テストで固定する。**
 * `outline-offset` は負で内側、`outline` はその内側の境界から**外向き**に太る。
 * レビューでも実装でも一度ずつ取り違えた。
 *
 * 座標系は**タブ（`.tab-bar__tab`）の border-box 上端を 0 とし、下向きを正**とする。
 */

/** 上端からの範囲。`top` / `bottom` はどちらもタブの border-box 上端からの距離（px） */
export interface Band {
  top: number;
  bottom: number;
}

/**
 * プロバイダの色相アクセント（`.tab-bar__tab` の `border-top`）が占める範囲。
 *
 * border-box の一番上なので、常に `0` から始まる。
 */
export function providerBand(borderTopWidth: number): Band {
  return { top: 0, bottom: borderTopWidth };
}

/**
 * フォーカスリング（`.tab-bar__tab-button` の `outline`）が占める範囲。
 *
 * `.tab-bar__tab-button` は `align-self: stretch` なので、その border-box 上端は
 * **タブの content-box 上端 = `borderTopWidth`** に一致する
 * （この前提自体が崩れていないことは E2E 側で実測して検算する）。
 *
 * `outline` の内側の境界はボタンの border 端から `outlineOffset` だけ**外向き**にあり、
 * そこから `outlineWidth` ぶん**さらに外向き**に太る。`outlineOffset` が負なら内側へ入る。
 *
 * - `offset: -2px, width: 2px` -> ボタン上端から 0〜2px（= 帯の直下に接する）
 * - `offset: -4px, width: 2px` -> ボタン上端から 2〜4px（= 帯との間に 2px の面が入る）
 */
export function focusRingBand(
  borderTopWidth: number,
  outlineWidth: number,
  outlineOffset: number,
): Band {
  const buttonTop = borderTopWidth;
  const innerEdge = buttonTop - outlineOffset;
  return { top: innerEdge - outlineWidth, bottom: innerEdge };
}

/**
 * 2つの帯の隙間（px）。**重なっていれば負**を返す。
 *
 * 負を 0 に丸めない。「接している（0）」と「重なっている（負）」は別の壊れ方で、
 * 丸めると後者が前者に化けて見えなくなる。
 */
export function gapPx(upper: Band, lower: Band): number {
  return lower.top - upper.bottom;
}

/**
 * 帯とリングが「隣接色」として扱われるか。
 *
 * WCAG 1.4.11 の隣接色は**接している**ものを指す。1px でも面が挟まれば、
 * その面が隣接色になるので、帯とリングの間に 3:1 を要求する理由が無くなる。
 *
 * **S41 のフォーカスリング 3:1 の assert は、この関数が true のときだけ意味を持つ。**
 * 逆に false なのに assert が残っていたら、それは要求しすぎている（そして
 * 「輝度だけでは両立しない」という誤った結論を再生産する）。
 */
export function ringTouchesProviderBand(
  borderTopWidth: number,
  outlineWidth: number,
  outlineOffset: number,
): boolean {
  return (
    gapPx(providerBand(borderTopWidth), focusRingBand(borderTopWidth, outlineWidth, outlineOffset)) <=
    0
  );
}
