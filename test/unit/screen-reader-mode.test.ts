// 読み上げモードの実効値の判定（src/shared/screen-reader-mode.ts。Issue #149）。
//
// **なぜ切り出したか。** 読み手が2つある（本体ウィンドウの `App.tsx` と
// 設定ウィンドウの表示）。同じ式を2箇所に書くと、3つ目の条件が増えた日に
// **設定ウィンドウだけが嘘をつく**。
//
// この PR は**値も挙動も1つも変えない置き換え**なので、ここで固定するのは
// 「置き換える前と同じ真理値表になっていること」。

import { describe, expect, it } from 'vitest';
import {
  DETECTED_NOTICE_TEXT,
  isScreenReaderModeEffective,
  shouldShowDetectedNotice,
} from '../../src/shared/screen-reader-mode';

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

describe('shouldShowDetectedNotice（設定ウィンドウの注記を出すか）', () => {
  it('検知していて、設定が off のときだけ出す（食い違っている状態）', () => {
    expect(shouldShowDetectedNotice({ screenReaderMode: false }, true)).toBe(true);
  });

  it('自分でチェックを入れているなら出さない（有効な理由が本人の設定なので説明が要らない）', () => {
    expect(shouldShowDetectedNotice({ screenReaderMode: true }, true)).toBe(false);
  });

  it('検知していなければ出さない（設定の on / off に関わらず）', () => {
    // 「無効です」を常時出すと、既定状態の全利用者にノイズを増やすだけになる。
    expect(shouldShowDetectedNotice({ screenReaderMode: false }, false)).toBe(false);
    expect(shouldShowDetectedNotice({ screenReaderMode: true }, false)).toBe(false);
  });

  it('注記を出すときは、必ず実効値も有効になっている', () => {
    // 「有効です」と書いてあるのに実際は無効、という組み合わせを作らせない。
    for (const screenReaderMode of [true, false]) {
      for (const support of [true, false]) {
        const config = { screenReaderMode };
        if (shouldShowDetectedNotice(config, support)) {
          expect(isScreenReaderModeEffective(config, support)).toBe(true);
        }
      }
    }
  });
});

describe('DETECTED_NOTICE_TEXT（文言の不変条件。design-review 由来）', () => {
  it('VoiceOver を検知したと断定しない', () => {
    // `app.accessibilitySupportEnabled` は支援技術全般で立つ（音声コントロール・
    // スイッチコントロール・AX API に繋ぐ自動化ツールでも真になる）。
    // 断定すると、VoiceOver を起動した覚えのない人に嘘をつくことになる。
    expect(DETECTED_NOTICE_TEXT).toContain('VoiceOver など');
    expect(DETECTED_NOTICE_TEXT).toContain('支援技術');
  });

  it('括弧とコロンを使わない', () => {
    // VoiceOver は句読点の読み上げ設定によって「かっこ」「コロン」を発話しうる。
    // まさにこの文を読む人にとってノイズになる。
    for (const punctuation of ['(', ')', '（', '）', ':', '：']) {
      expect(DETECTED_NOTICE_TEXT).not.toContain(punctuation);
    }
  });

  it('状態を先頭に置く', () => {
    // この文はチェックボックスの `aria-describedby` から参照され、読み上げでは
    // 「…チェックボックス、オフ」の直後に読まれる。矛盾を最短で打ち消す語順にする。
    expect(DETECTED_NOTICE_TEXT.startsWith('いま有効です')).toBe(true);
  });
});

