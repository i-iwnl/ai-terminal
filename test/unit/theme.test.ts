// クロームの面を theme.background から機械的に導出するロジック（Issue #20 の G
// 「テーマ（方向を逆にする）」）を固定する。
//
// 既定背景でこの導出結果が既存の SURFACE 定数（src/shared/defaults.ts）と
// 1バイトもずれないことが「画像0枚（見た目が変わらない）」の前提そのものなので、
// 最初のケースで直接突き合わせる。
//
// 面だけを導出し文字色は静的なままなので、明るい背景では静的な文字色との
// contrast が壊れる（レビュー差し戻し・1回目）。そのガード
// （chromeTextRemainsReadable / chromeSafeToApply）も実測値で固定する。
//
// 1回目のガードは二値（適用する/しない）だったため、Solarized Dark のような
// 「僅かに 4.5:1 を割るだけの暗いテーマ」まで一律に弾いていた（レビュー差し戻し・
// 2回目）。オフセットの縮小係数（1 / 0.8 / 0.6）を段階的に試す
// `resolveChromeSurfaces()` を追加し、暗いテーマは救い、明るいテーマは
// どれだけ縮めても救えないことを実測値で固定する。

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHROME_TEXT,
  chromeTextRemainsReadable,
  contrastRatio,
  deriveChromeSurfaces,
  resolveChromeSurfaces,
  terminalThemeFrom,
} from '../../src/shared/theme';
import { DEFAULT_THEME, SURFACE } from '../../src/shared/defaults';

describe('deriveChromeSurfaces', () => {
  it('既定の background では、既存の SURFACE 定数と1バイトも変わらない', () => {
    const result = deriveChromeSurfaces(DEFAULT_THEME.background);

    expect(result).toEqual({
      surface0: SURFACE.sidebar,
      surface1: SURFACE.base,
      surface2: SURFACE.hover,
      surface3: SURFACE.raised,
    });
  });

  it('surface1 は常に background そのもの', () => {
    const result = deriveChromeSurfaces('#002b36');
    expect(result.surface1).toBe('#002b36');
  });

  it('有彩色の background でも、各チャンネルへ同じオフセットを足すだけで導出する', () => {
    // Solarized Dark の base03 (#002b36 = r0,g43,b54)。
    // R チャンネルは 0 未満にクランプされるため、-10 では G/B だけが動く。
    const result = deriveChromeSurfaces('#002b36');

    expect(result.surface0).toBe('#00212c'); // (0,33,44)
    expect(result.surface2).toBe('#042f3a'); // (4,47,58)
    expect(result.surface3).toBe('#0a3540'); // (10,53,64)
  });

  it('明るい background でチャンネルが255を超える場合はクランプする', () => {
    // 白に近い background (#fafafa = 250,250,250) に +10 すると 260 になる
    const result = deriveChromeSurfaces('#fafafa');
    expect(result.surface3).toBe('#ffffff');
  });

  it('暗い background でチャンネルが0を下回る場合はクランプする', () => {
    // 純黒に -10 しても 0 未満にはならない
    const result = deriveChromeSurfaces('#000000');
    expect(result.surface0).toBe('#000000');
  });

  it('3桁の hex（#rgb）も展開して扱う', () => {
    // #333 = #333333（0x33 = 51）
    const result = deriveChromeSurfaces('#333');
    expect(result.surface1).toBe('#333');
    expect(result.surface0).toBe('#292929'); // 51-10=41=0x29
  });

  it('パースできない background は、全面をそのまま返す（アプリを落とさない）', () => {
    const result = deriveChromeSurfaces('not-a-color');
    expect(result).toEqual({
      surface0: 'not-a-color',
      surface1: 'not-a-color',
      surface2: 'not-a-color',
      surface3: 'not-a-color',
    });
  });
});

describe('terminalThemeFrom', () => {
  it('terminal はそのまま返し、chrome は同じ background から導出する', () => {
    const theme = {
      background: DEFAULT_THEME.background,
      foreground: '#d4d4d4',
      cursor: '#d4d4d4',
      selectionBackground: '#264f78',
    };

    const derived = terminalThemeFrom(theme);

    expect(derived.terminal).toEqual(theme);
    expect(derived.chrome).toEqual(deriveChromeSurfaces(theme.background));
  });

  it('既定背景では chromeSafeToApply が true、chromeScale が 1 になる', () => {
    const theme = {
      background: DEFAULT_THEME.background,
      foreground: '#d4d4d4',
      cursor: '#d4d4d4',
      selectionBackground: '#264f78',
    };

    const derived = terminalThemeFrom(theme);
    expect(derived.chromeSafeToApply).toBe(true);
    expect(derived.chromeScale).toBe(1);
  });
});

describe('CHROME_TEXT と styles.css の一致', () => {
  // CSS 変数は Main プロセスから読めないため、SURFACE と同じ理由で
  // CHROME_TEXT は styles.css の --text-primary/secondary/tertiary の
  // 複製にならざるを得ない。ずれるとコントラスト判定そのものが無意味になるので、
  // css-tokens.test.ts と同じやり方で styles.css を直接読んで突き合わせる。
  const CSS = readFileSync(
    resolve(import.meta.dirname, '../../src/renderer/src/styles.css'),
    'utf8',
  );

  function declaredValue(name: string): string | undefined {
    const match = new RegExp(`^\\s*${name}:\\s*(#[0-9a-fA-F]{3,6})\\s*;`, 'm').exec(CSS);
    return match?.[1];
  }

  it('CHROME_TEXT.primary が --text-primary の宣言値と一致する', () => {
    expect(declaredValue('--text-primary')).toBe(CHROME_TEXT.primary);
  });

  it('CHROME_TEXT.secondary が --text-secondary の宣言値と一致する', () => {
    expect(declaredValue('--text-secondary')).toBe(CHROME_TEXT.secondary);
  });

  it('CHROME_TEXT.tertiary が --text-tertiary の宣言値と一致する', () => {
    expect(declaredValue('--text-tertiary')).toBe(CHROME_TEXT.tertiary);
  });
});

describe('contrastRatio', () => {
  it('白と黒で 21:1 になる（既知値による式の検証）', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1);
  });

  it('同じ色同士は 1:1', () => {
    expect(contrastRatio('#282828', '#282828')).toBeCloseTo(1, 5);
  });

  it('前景・背景の順序を入れ替えても同じ比になる', () => {
    expect(contrastRatio('#e6e6e6', '#282828')).toBeCloseTo(
      contrastRatio('#282828', '#e6e6e6'),
      10,
    );
  });

  it('パースできない色は 1（最も厳しい判定）を返す', () => {
    expect(contrastRatio('not-a-color', '#282828')).toBe(1);
  });
});

describe('chromeTextRemainsReadable（scale=1・縮小前の生の判定）', () => {
  // scale=1（オフセットを縮めない生の導出）に対する判定を固定する。
  // 「scale=1 でどうか」であって最終結果ではない — 実際に採用されるかどうかは
  // resolveChromeSurfaces()（下の describe）が縮小を試みた後で決める。

  it('既定 #1e1e1e: 3段とも 4.5:1 を満たす', () => {
    const surfaces = deriveChromeSurfaces('#1e1e1e');
    expect(contrastRatio(CHROME_TEXT.primary, surfaces.surface3)).toBeCloseTo(11.81, 1);
    expect(contrastRatio(CHROME_TEXT.secondary, surfaces.surface3)).toBeCloseTo(6.2, 1);
    expect(contrastRatio(CHROME_TEXT.tertiary, surfaces.surface3)).toBeCloseTo(4.86, 1);
    expect(chromeTextRemainsReadable(surfaces)).toBe(true);
  });

  it('Solarized Dark #002b36: scale=1 では tertiary が僅かに届かない', () => {
    // primary (10.54) / secondary (5.53) は 4.5:1 を満たすが、
    // tertiary は 4.34 で割る。3段すべてを見て初めて分かる（primary だけでは
    // 気づけない）。resolveChromeSurfaces() が縮小を試みて救う（下の describe）。
    const surfaces = deriveChromeSurfaces('#002b36');
    expect(contrastRatio(CHROME_TEXT.primary, surfaces.surface3)).toBeCloseTo(10.54, 1);
    expect(contrastRatio(CHROME_TEXT.secondary, surfaces.surface3)).toBeCloseTo(5.53, 1);
    expect(contrastRatio(CHROME_TEXT.tertiary, surfaces.surface3)).toBeCloseTo(4.34, 1);
    expect(chromeTextRemainsReadable(surfaces)).toBe(false);
  });

  it('Solarized Light #fdf6e3: 明るい背景なので大きく割る', () => {
    const surfaces = deriveChromeSurfaces('#fdf6e3');
    expect(contrastRatio(CHROME_TEXT.primary, surfaces.surface3)).toBeCloseTo(1.23, 1);
    expect(chromeTextRemainsReadable(surfaces)).toBe(false);
  });

  it('白 #ffffff: 最も明るい背景で、当然割る', () => {
    const surfaces = deriveChromeSurfaces('#ffffff');
    expect(contrastRatio(CHROME_TEXT.primary, surfaces.surface3)).toBeCloseTo(1.25, 1);
    expect(chromeTextRemainsReadable(surfaces)).toBe(false);
  });
});

describe('resolveChromeSurfaces（オフセットの段階的な縮小）', () => {
  // レビュー差し戻し・2回目の核心: 二値の可否ではなく、1 -> 0.8 -> 0.6 の順に
  // 縮小を試み、最初に3段すべてが 4.5:1 を満たした係数を採用する。
  // 0.6 でも満たさなければ諦める（明るい背景はどれだけ縮めても救えない）。

  it('既定 #1e1e1e: scale=1 で満たし、SURFACE 定数と1バイトも変わらない', () => {
    const result = resolveChromeSurfaces(DEFAULT_THEME.background);

    expect(result.chromeSafeToApply).toBe(true);
    expect(result.chromeScale).toBe(1);
    expect(result.chrome).toEqual({
      surface0: SURFACE.sidebar,
      surface1: SURFACE.base,
      surface2: SURFACE.hover,
      surface3: SURFACE.raised,
    });
  });

  it('Solarized Dark #002b36: scale=1 と 0.8 では届かず、0.6 で3段とも満たす', () => {
    const result = resolveChromeSurfaces('#002b36');

    expect(result.chromeSafeToApply).toBe(true);
    expect(result.chromeScale).toBe(0.6);
    // scale=0.6 のときの実測値（-10*0.6=-6 / +4*0.6=+2(丸め) / +10*0.6=+6）
    expect(result.chrome).toEqual({
      surface0: '#002530',
      surface1: '#002b36',
      surface2: '#022d38',
      surface3: '#06313c',
    });
    expect(contrastRatio(CHROME_TEXT.primary, result.chrome.surface3)).toBeCloseTo(11.13, 1);
    expect(contrastRatio(CHROME_TEXT.secondary, result.chrome.surface3)).toBeCloseTo(5.84, 1);
    expect(contrastRatio(CHROME_TEXT.tertiary, result.chrome.surface3)).toBeCloseTo(4.58, 1);
  });

  it('Dracula #282a36: 0.6 まで縮めても tertiary が届かず、適用しない', () => {
    // 0.6 でも tertiary が 4.32 で割る（0.2 まで縮めれば救えるが、
    // 0.6 を下限にしているため採用しない。面の段差が読めなくなる手前で止める）。
    const result = resolveChromeSurfaces('#282a36');

    expect(result.chromeSafeToApply).toBe(false);
    expect(result.chromeScale).toBeUndefined();
    expect(contrastRatio(CHROME_TEXT.tertiary, deriveChromeSurfaces('#282a36', 0.6).surface3)).toBeLessThan(4.5);
  });

  it('Solarized Light #fdf6e3: 縮小しても救えず、適用しない', () => {
    const result = resolveChromeSurfaces('#fdf6e3');
    expect(result.chromeSafeToApply).toBe(false);
    expect(result.chromeScale).toBeUndefined();
  });

  it('白 #ffffff: 縮小しても救えず、適用しない', () => {
    const result = resolveChromeSurfaces('#ffffff');
    expect(result.chromeSafeToApply).toBe(false);
    expect(result.chromeScale).toBeUndefined();
  });
});
