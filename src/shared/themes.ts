/**
 * ターミナルの配色プリセット（Issue #119 周6 / #20 の PR 18）。
 *
 * `src/shared/theme.ts`（単数形）が「background から**クロームの面を導出する**」
 * 仕組みで、こちらは「**選べる background の一覧**」。混同しないこと。
 *
 * ## なぜ自由入力ではなくプリセットなのか
 *
 * `theme.background` は `config.json` を直接編集すれば以前から変えられた。
 * だが**任意の色を選べる UI にすると、`chromeSafeToApply` が false になる色を
 * 選べてしまう。** そのとき何が起きるかというと:
 *
 * - `useTerminal.ts` は `chromeSafeToApply` を見ずに `term.options.theme` を
 *   **無条件に適用する**（ターミナルは新しい背景になる）
 * - `App.tsx` はクロームの面の適用を**見送る**（サイドバーとタブバーは元のまま）
 *
 * つまり「何も起きない」ではなく「**端末だけ明るくなり、クロームが暗いまま残る
 * 半適用**」になる。何も起きないより強い故障に見える。
 *
 * **プリセットに閉じ、そのプリセットが安全であることを単体テストで関門にする。**
 *
 * ## 落選した有名テーマ（実測）
 *
 * | テーマ | background | 判定 |
 * |---|---|---|
 * | Nord | `#2e3440` | **不可** |
 * | Dracula | `#282a36` | **不可** |
 * | One Dark | `#282c34` | **不可** |
 * | Gruvbox Dark | `#282828` | **不可** |
 *
 * いずれも背景が明るめで、面を導出すると `--surface-3` が静的な文字色
 * （`--text-tertiary` #949494）に対して 4.5:1 を割る。オフセットを 0.6 倍まで
 * 縮めても届かない（`resolveChromeSurfaces` が3段すべて試したうえで諦める）。
 *
 * **これを直すにはクロームの文字色まで背景から導出する必要がある**（`theme.ts` の
 * 冒頭が「文字色まで含めたパレット化は PR 18 の範囲」と書いている部分）。
 * ただしそれは Phase 1 が実測で積み上げた「すべての段が最も明るい面の上でも
 * 4.5:1」という保証を動的にする変更で、`S40` の性格が変わる。**この周では
 * 面だけの導出に留め、通らないテーマは候補に入れない。**
 */

import type { TerminalTheme } from './ipc';
import { DEFAULT_THEME } from './defaults';

/**
 * `AppConfig.themeName` が取りうる特別な値。
 *
 * **最初から型に入れておく。** あとから足すと `coerceConfig` を2回触ることになる。
 *
 * - `''` … 未設定。**保存済みの `theme`（4色）が勝つ。** 既存の `config.json` を
 *   手で書いていた利用者と `S21-config.spec.ts` を壊さないための既定
 * - `'custom'` … プリセットから外れて自分で4色を決めた状態。
 *   プリセットを一度選んだあと、`config.json` を手で編集して戻る道を残す
 */
export const THEME_NAME_UNSET = '';
export const THEME_NAME_CUSTOM = 'custom';

export interface ThemePreset {
  /** `AppConfig.themeName` に保存する識別子 */
  id: string;
  /** 設定ウィンドウに出す名前 */
  label: string;
  theme: TerminalTheme;
}

/**
 * 選べるプリセット。
 *
 * **すべて `chromeSafeToApply === true` でなければならない**（`test/unit/themes.test.ts`
 * が関門にしている）。候補を足すときは、まずテストを回して落ちないことを確かめる。
 *
 * `selectionBackground` は**その前景が乗った状態で 4.5:1 を満たす**ことも
 * 同じテストで見る（`test/unit/selection-contrast.test.ts` が既定テーマについて
 * 記録している「塗りの 3:1 と文字の 4.5:1 は両立しない」の一般化）。
 */
export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    id: 'default',
    label: '既定（ダーク）',
    theme: DEFAULT_THEME,
  },
  {
    id: 'tokyo-night',
    label: 'Tokyo Night',
    theme: {
      background: '#1a1b26',
      foreground: '#c0caf5',
      cursor: '#c0caf5',
      selectionBackground: '#28344a',
    },
  },
  {
    id: 'github-dark',
    label: 'GitHub Dark',
    theme: {
      background: '#0d1117',
      foreground: '#c9d1d9',
      cursor: '#c9d1d9',
      selectionBackground: '#1f3a5f',
    },
  },
  {
    id: 'catppuccin-mocha',
    label: 'Catppuccin Mocha',
    theme: {
      background: '#1e1e2e',
      foreground: '#cdd6f4',
      cursor: '#f5e0dc',
      selectionBackground: '#353a56',
    },
  },
  {
    id: 'solarized-dark',
    label: 'Solarized Dark',
    theme: {
      background: '#002b36',
      foreground: '#93a1a1',
      cursor: '#93a1a1',
      // Solarized の base02。**#0b4250（より明るい案）は前景 #93a1a1 に対し
      // 4.11 で 1.4.3 を割った**（`test/unit/themes.test.ts` が落として教えた）。
      // base02 なら 4.86。塗りを明るくするほど選択範囲は目立つが、
      // **拘束するのは塗りの上の文字**（既定テーマで実証済み）。
      selectionBackground: '#073642',
    },
  },
];

/**
 * `themeName` からプリセットを引く。**未設定・未知の値では `undefined`。**
 *
 * CLAUDE.md 鉄則5: 外部由来（`config.json`）の値がそのまま来る経路なので、
 * 知らない名前でも落とさず「プリセットではない」に縮退する。
 */
export function findThemePreset(themeName: string | undefined): ThemePreset | undefined {
  if (themeName === undefined || themeName === THEME_NAME_UNSET) return undefined;
  if (themeName === THEME_NAME_CUSTOM) return undefined;
  return THEME_PRESETS.find((preset) => preset.id === themeName);
}

/**
 * 実際に適用する `TerminalTheme` を決める。
 *
 * **`themeName` が有効なプリセットを指しているときだけプリセットが勝つ。**
 * 未設定・`custom`・未知の名前では、保存済みの `theme`（4色）をそのまま使う。
 *
 * この順序が重要で、逆にすると `S21-config.spec.ts`（`theme.background` を
 * 直接指定して反映を見るシナリオ）が落ちる。**設定ファイルに明示した4色が
 * 黙って無視される**のは、`config.json` を手で書いてきた利用者にとって
 * 「壊れた」としか見えない。
 */
export function resolveTheme(config: {
  themeName?: string;
  theme: TerminalTheme;
}): TerminalTheme {
  return findThemePreset(config.themeName)?.theme ?? config.theme;
}
