// ターミナルの選択範囲の塗り（`TerminalTheme.selectionBackground`）に関門を置く。
//
// **この値を検査するテストは1本も無かった。** `grep -rn selectionBackground` の結果は
// `src/shared/defaults.ts` / `src/shared/ipc.ts` / `useTerminal.ts` の `toXtermTheme` /
// `e2e/specs/S21-config.spec.ts`（渡すだけで assert しない）のみで、**どんな値に変えても
// フル実行が green のまま main に入る**状態だった（S40 / S70 / S71 と同じ穴）。
//
// **E2E の S40 では測れない。** 選択範囲は xterm が canvas（WebglAddon）に描くので
// DOM に存在せず、`e2e/fixtures/contrast.ts` の `measureContrast()` は
// `getComputedStyle` で解く実装のため到達できない。したがってこのリポジトリの規律で
// 言う「実測」は、ここでは `src/shared/theme.ts` の `contrastRatio()`（S40 と同じ式）
// による計算が担う。
//
// ---
//
// **Issue #119 の周1で、この関門を置いた経緯。**
//
// #20 の Phase 1 は `selectionBackground: #264f78` を「対背景 2.03 で 3:1 に届かない」
// として P2 の積み残しに送り、`#2f5d8f`（2.53）への引き上げ案を残していた。
// #119 の5ペルソナレビューで、この前提が2つとも壊れた。
//
// 1. **数値が誤っていた。** 実測は 2.03 ではなく **1.96**、案の 2.53 は **2.45**。
//    design-rules が「紙のコントラスト表はこのリポジトリで3回続けて誤った」と
//    記録している型の4件目。
// 2. **選択範囲の塗りは WCAG 1.4.11（非テキスト 3:1）の対象ではない。**
//    1.4.11 が拘束するのは (a) 利用者が単一のコントロールとして知覚する部分と
//    その状態、(b) 内容の理解に必要な graphical object の2つで、選択ハイライトは
//    どちらでもない（利用者自身の操作へのフィードバック）。
//    **拘束するのは 1.4.3 で、それは塗りの上に載るテキストの側。**
//
// その結果、`#2f5d8f` への引き上げは**改善ではなく退行**だった。
// 既定前景 `#d4d4d4` の比が **5.73 -> 4.59** に落ちる（AA ぎりぎり）。
// 塗りを 3:1 まで上げるには `#3a6ea5` 相当が必要だが、そこでは前景が 3.58 まで落ちて
// 1.4.3 を割る。**塗りの 3:1 と文字の 4.5:1 は `#d4d4d4` 前景では両立しない。**
// 唯一の抜け道は `selectionForeground` を固定することだが、それは
// **選択中だけ ANSI の色が全部潰れる**ことを意味し、ターミナルとして対価が大きすぎる。
// （macOS 自身の `selectedTextBackgroundColor` も 3:1 を満たしていない。）
//
// **結論: `#264f78` を据え置く。** 却下の記録は
// `.claude/skills/design-review/reference/design-rules.md` の「却下済みの案」にもある。
//
// このファイルが守るのは「次に誰かが塗りを明るくしようとしたとき、
// その上の文字が 4.5:1 を割ったら赤くなる」こと。

import { describe, expect, it } from 'vitest';

import { contrastRatio } from '@shared/theme';
import { DEFAULT_THEME } from '@shared/defaults';

/** WCAG 1.4.3（通常テキスト）。選択範囲で実際に拘束されるのはこちら。 */
const MIN_TEXT_CONTRAST = 4.5;

describe('ターミナルの選択範囲', () => {
  it('既定値が #264f78 のまま据え置かれている', () => {
    // 値そのものを固定する（characterization）。変えたいときはこの行を書き換え、
    // 下の2件が通ることを確認するのが作業の一部になる。
    expect(DEFAULT_THEME.selectionBackground).toBe('#264f78');
  });

  it('選択範囲の上でも、既定の前景が 4.5:1 を保つ', () => {
    // **ここが本当の関門。** 塗りを明るくすると必ずここが落ちる。
    const ratio = contrastRatio(DEFAULT_THEME.foreground, DEFAULT_THEME.selectionBackground);
    expect(ratio).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    // 実測 5.73。桁が動いたら「何と比べたか」を疑うこと（design-rules）。
    expect(Number(ratio.toFixed(2))).toBe(5.73);
  });

  it('カーソルも選択範囲の上で 4.5:1 を保つ', () => {
    // cursor は foreground と同値（#d4d4d4）だが、片方だけ変えられる型なので
    // 独立に見る。選択範囲の中にカーソルが入るのは通常の操作。
    const ratio = contrastRatio(DEFAULT_THEME.cursor, DEFAULT_THEME.selectionBackground);
    expect(ratio).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });

  it('塗りを 3:1 まで上げると、その上の文字が 4.5:1 を割る（両立しないことの記録）', () => {
    // 「3:1 に届かないから上げよう」を次に誰かが思いついたときのための記録。
    // #3a6ea5 は対背景 3:1 に届く最小付近の値。
    const fill = '#3a6ea5';
    expect(contrastRatio(fill, DEFAULT_THEME.background)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(DEFAULT_THEME.foreground, fill)).toBeLessThan(MIN_TEXT_CONTRAST);
  });
});
