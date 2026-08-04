// タブ上端の2本の帯（プロバイダの色相アクセントとフォーカスリング）の幾何。
//
// **この単体テストの役割は「現状を固定する」ことではなく、符号と向きを固定すること。**
// `outline-offset` は負で内側、`outline` はその内側の境界から外向きに太る、という
// 組み合わせは実際に取り違えやすく、Issue #179 周2.5 のレビューでも実装でも一度ずつ間違えた。
//
// E2E 側（S41）は `getComputedStyle` の実測値をこの関数に流し込むだけにして、
// **算術をテスト本文に書かない**。同じ計算を2箇所に書くと、片方が間違ったときに
// 「両方同じように間違える」か「食い違って原因が分からなくなる」のどちらかになる。

import { describe, expect, it } from 'vitest';

import {
  focusRingBand,
  gapPx,
  providerBand,
  ringTouchesProviderBand,
} from '../../src/renderer/src/tabs/tabBandGeometry';

describe('プロバイダの帯', () => {
  it('タブの border-box 上端から始まる', () => {
    expect(providerBand(2)).toEqual({ top: 0, bottom: 2 });
  });

  it('太さを変えると下端だけが動く（上端は 0 のまま）', () => {
    expect(providerBand(4)).toEqual({ top: 0, bottom: 4 });
  });
});

describe('フォーカスリング', () => {
  // `.tab-bar__tab-button` は align-self: stretch なので、その border-box 上端は
  // タブの content-box 上端（= borderTopWidth）に一致する。

  it('outline-offset が負なら内側に入る', () => {
    // offset -2 / width 2 -> ボタン上端から 0〜2px
    expect(focusRingBand(2, 2, -2)).toEqual({ top: 2, bottom: 4 });
  });

  it('offset をさらに負にすると、内側へ押し込まれる', () => {
    // offset -4 / width 2 -> ボタン上端から 2〜4px
    expect(focusRingBand(2, 2, -4)).toEqual({ top: 4, bottom: 6 });
  });

  it('offset が 0 なら、ボタンの border 端から外向きに太る', () => {
    expect(focusRingBand(2, 2, 0)).toEqual({ top: 0, bottom: 2 });
  });

  it('offset が正なら、ボタンの外側へ出る（帯に食い込む向き）', () => {
    // 外向きなので上端は負（= タブの border-box より上）にもなりうる
    expect(focusRingBand(2, 2, 2)).toEqual({ top: -2, bottom: 0 });
  });

  it('リングの厚みは常に outlineWidth に等しい', () => {
    for (const offset of [-6, -4, -2, 0, 2]) {
      const band = focusRingBand(2, 2, offset);
      expect(band.bottom - band.top).toBe(2);
    }
  });
});

describe('帯とリングの隙間', () => {
  // **現状（-2px）の 0 も一緒に固定する。** S40 の characterization と同じ作法で、
  // 「いまこうなっている」を明示しておかないと、直したときに何が変わったか言えない。

  it('outline-offset: -2px では隙間が 0（接している）= Issue #165 が詰んでいた状態', () => {
    const gap = gapPx(providerBand(2), focusRingBand(2, 2, -2));
    expect(gap).toBe(0);
    expect(ringTouchesProviderBand(2, 2, -2)).toBe(true);
  });

  it('outline-offset: -4px では隙間が 2px 空く（面が挟まる）= 周2.5 で入れた状態', () => {
    const gap = gapPx(providerBand(2), focusRingBand(2, 2, -4));
    expect(gap).toBe(2);
    expect(ringTouchesProviderBand(2, 2, -4)).toBe(false);
  });

  it('隙間は borderTopWidth に依らない（= 帯を太くしても隙間は変わらない）', () => {
    // #165 後半で帯の太さを識別軸に使う案があるので、その周で壊れないことを先に固定する。
    for (const borderTopWidth of [2, 3, 4]) {
      expect(gapPx(providerBand(borderTopWidth), focusRingBand(borderTopWidth, 2, -4))).toBe(2);
    }
  });

  it('重なっているときは負を返す（0 に丸めない）', () => {
    // offset が正だとリングが帯に食い込む。「接している」と「重なっている」は別の壊れ方。
    expect(gapPx(providerBand(2), focusRingBand(2, 2, 2))).toBe(-4);
    expect(ringTouchesProviderBand(2, 2, 2)).toBe(true);
  });

  it('リングが太くなると隙間はそのぶん詰まる', () => {
    // outline-width を 2 -> 3 にすると、外向きに太るので帯へ近づく
    expect(gapPx(providerBand(2), focusRingBand(2, 3, -4))).toBe(1);
    expect(gapPx(providerBand(2), focusRingBand(2, 4, -4))).toBe(0);
    expect(ringTouchesProviderBand(2, 4, -4)).toBe(true);
  });
});
