// ターミナルの配色プリセット（Issue #119 周6 / #20 の PR 18）。
//
// **この関門があるからプリセット方式にできる。** 自由入力にすると
// `chromeSafeToApply` が false になる色を選べてしまい、そのとき起きるのは
// 「何も起きない」ではなく「**端末だけ明るくなり、クロームが暗いまま残る半適用**」
// （`useTerminal.ts` は chromeSafeToApply を見ずに term.options.theme を適用し、
// `App.tsx` はクロームの面の適用を見送るため）。

import { describe, expect, it } from 'vitest';

import { contrastRatio, resolveChromeSurfaces } from '@shared/theme';
import {
  THEME_NAME_CUSTOM,
  THEME_NAME_UNSET,
  THEME_PRESETS,
  findThemePreset,
  resolveTheme,
} from '@shared/themes';
import { DEFAULT_THEME } from '@shared/defaults';

/** WCAG 1.4.3（通常テキスト） */
const MIN_TEXT_CONTRAST = 4.5;

describe('プリセットの安全性（追加するときの関門）', () => {
  it('プリセットが1つ以上ある', () => {
    expect(THEME_PRESETS.length).toBeGreaterThan(0);
  });

  it('id が重複していない', () => {
    const ids = THEME_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('id に特別な値（未設定 / custom）を使っていない', () => {
    // 使うと「プリセットを選んだ」と「未設定」が区別できなくなる。
    for (const preset of THEME_PRESETS) {
      expect(preset.id).not.toBe(THEME_NAME_UNSET);
      expect(preset.id).not.toBe(THEME_NAME_CUSTOM);
    }
  });

  it.each(THEME_PRESETS.map((p) => [p.label, p] as const))(
    '%s: クロームの面を導出しても文字が 4.5:1 を保つ',
    (_label, preset) => {
      // **ここが本命の関門。** false のプリセットを足すと、選んだ瞬間に
      // 端末だけ色が変わってクロームが取り残される。
      //
      // 実測で落選した有名テーマ: Nord #2e3440 / Dracula #282a36 /
      // One Dark #282c34 / Gruvbox Dark #282828（いずれも背景が明るめで、
      // オフセットを 0.6 倍まで縮めても --text-tertiary が 4.5:1 を割る）。
      const resolved = resolveChromeSurfaces(preset.theme.background);
      expect(resolved.chromeSafeToApply).toBe(true);
    },
  );

  it.each(THEME_PRESETS.map((p) => [p.label, p] as const))(
    '%s: 選択範囲の上でも前景が 4.5:1 を保つ',
    (_label, preset) => {
      // `test/unit/selection-contrast.test.ts` が既定テーマについて記録している
      // 「**塗りの 3:1 と文字の 4.5:1 は両立しない**（拘束するのは後者）」を
      // 全プリセットへ一般化したもの。選択範囲を暗くしすぎても明るくしすぎても落ちる。
      const ratio = contrastRatio(preset.theme.foreground, preset.theme.selectionBackground);
      expect(ratio).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    },
  );

  it.each(THEME_PRESETS.map((p) => [p.label, p] as const))(
    '%s: 背景の上で前景が 4.5:1 を保つ',
    (_label, preset) => {
      const ratio = contrastRatio(preset.theme.foreground, preset.theme.background);
      expect(ratio).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    },
  );

  it.each(THEME_PRESETS.map((p) => [p.label, p] as const))(
    '%s: カーソルが背景から 3:1 以上離れている',
    (_label, preset) => {
      // カーソルはテキストではないので 1.4.11（非テキスト 3:1）。
      // **見えないカーソルはターミナルとして成立しない。**
      expect(contrastRatio(preset.theme.cursor, preset.theme.background)).toBeGreaterThanOrEqual(3);
    },
  );

  it('既定のプリセットが DEFAULT_THEME と同一である', () => {
    // ずれると「既定を選び直したのに元に戻らない」になる。
    const preset = THEME_PRESETS.find((p) => p.id === 'default');
    expect(preset?.theme).toEqual(DEFAULT_THEME);
  });
});

describe('findThemePreset / resolveTheme（どちらが勝つか）', () => {
  const custom: (typeof THEME_PRESETS)[number]['theme'] = {
    background: '#123456',
    foreground: '#ffffff',
    cursor: '#ffffff',
    selectionBackground: '#654321',
  };

  it('未設定なら保存済みの theme が勝つ', () => {
    // **これが `S21-config.spec.ts` を守っている。** 逆にすると、
    // config.json に明示した4色が黙って無視される。
    expect(resolveTheme({ theme: custom })).toEqual(custom);
    expect(resolveTheme({ themeName: THEME_NAME_UNSET, theme: custom })).toEqual(custom);
  });

  it('custom でも保存済みの theme が勝つ', () => {
    // プリセットを一度選んだあと、config.json を手で編集して戻る道。
    expect(resolveTheme({ themeName: THEME_NAME_CUSTOM, theme: custom })).toEqual(custom);
  });

  it('未知の名前でも落ちず、保存済みの theme に縮退する', () => {
    // CLAUDE.md 鉄則5。config.json は外部由来。
    expect(findThemePreset('no-such-theme')).toBeUndefined();
    expect(resolveTheme({ themeName: 'no-such-theme', theme: custom })).toEqual(custom);
  });

  it('有効なプリセットを指しているときだけプリセットが勝つ', () => {
    const target = THEME_PRESETS.find((p) => p.id === 'tokyo-night');
    expect(target).toBeDefined();
    expect(resolveTheme({ themeName: 'tokyo-night', theme: custom })).toEqual(target?.theme);
  });
});
