// 読み上げモードの実効値の判定（src/shared/screen-reader-mode.ts。Issue #149）。
//
// **なぜ切り出したか。** 読み手が2つある（本体ウィンドウの `App.tsx` と
// 設定ウィンドウの表示）。同じ式を2箇所に書くと、3つ目の条件が増えた日に
// **設定ウィンドウだけが嘘をつく**。
//
// この PR は**値も挙動も1つも変えない置き換え**なので、ここで固定するのは
// 「置き換える前と同じ真理値表になっていること」。

import { describe, expect, it } from 'vitest';
import { isScreenReaderModeEffective } from '../../src/shared/screen-reader-mode';

describe('isScreenReaderModeEffective', () => {
  it('設定が on なら、支援技術を検知していなくても有効', () => {
    expect(isScreenReaderModeEffective({ screenReaderMode: true }, false)).toBe(true);
  });

  it('⭐ 設定が off でも、支援技術を検知していれば有効（自動検知の狙い）', () => {
    // 設定の存在を知らない利用者でも読める状態になる、というのがこの分岐の理由。
    expect(isScreenReaderModeEffective({ screenReaderMode: false }, true)).toBe(true);
  });

  it('両方 true でも有効', () => {
    expect(isScreenReaderModeEffective({ screenReaderMode: true }, true)).toBe(true);
  });

  it('設定が off で検知もしていなければ無効（既定の状態）', () => {
    // 既定で無効にしているのは、読み上げ用の DOM を生やすと描画が重くなるため。
    expect(isScreenReaderModeEffective({ screenReaderMode: false }, false)).toBe(false);
  });
});
