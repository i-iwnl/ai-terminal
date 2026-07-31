/**
 * クロームの配色を、ユーザーが設定した `AppConfig.theme.background`（既定 `#1e1e1e`）から
 * 機械的に導出する。Issue #20 の G「テーマ（方向を逆にする）」の採用案。
 *
 * **却下した方向: クロームのトークンからターミナル配色を逆算する。**
 * ユーザーが触りたいのはターミナルの配色（`theme` の4色）であって、クロームの色ではない。
 * その方向だと既存の `theme` 設定が実質死ぬ。
 *
 * **採る方向: ターミナル背景 -> クロームの surface を明度差で生成する（この一方向だけ）。**
 * Solarized Dark 等を `theme.background` に設定すれば、クロームがそれに追従する。
 * 設定項目を1つも増やさずに「明るいクローム＋暗いターミナル」の破綻を消せるのはこの方向だけ。
 *
 * **絶対に守ること（CLAUDE.md 鉄則2）: xterm の ITheme を CSS 変数から
 * `getComputedStyle` で読んではいけない。** 「CSS が壊れると端末の色が壊れる」経路ができ、
 * PTY 出力を加工しない境界が CSS 側に漏れる。ITheme へは必ずこのファイルの関数から
 * 直接 `TerminalTheme` を渡すこと（CSS を経由しない）。方向は常に
 * 「TS のパレット -> CSS 変数」の一方向で、逆は作らない。
 *
 * **面だけを導出し、文字色は導出しない（この PR の意図的な範囲）。**
 * クロームの文字色（`--text-primary` 等）は静的なままなので、導出した面が
 * 明るくなりすぎると静的な文字色との組み合わせが WCAG 1.4.3（4.5:1）を割る。
 * `chromeTextRemainsReadable()` がそれを検知し、割るときは呼び出し側が
 * 導出結果を CSS へ適用しない（`DerivedTheme.chromeSafeToApply` を見る）。
 * 「壊れた配色を出すより、追従しないほうがまし」という判断（既知の制限として
 * 記録済み。文字色まで含めたパレット化は PR 18 の範囲）。
 *
 * **明度差は一様なオフセットのみでなく、段階的に縮小もする（`resolveChromeSurfaces()`）。**
 * Solarized Dark のような比較的暗い背景は、既定オフセット（1.0倍）では
 * `--text-tertiary` が僅かに 4.5:1 を割ることがある。オフセットを 0.8 倍・0.6 倍と
 * 縮めると救えるケースがあるため、最初に3段すべてが基準を満たした係数を採用する。
 * **0.6 を下限にする**のは、それ以上縮めると面の段差（`--surface-2` の
 * ホバーは既定でも対サイドバー比 1.16 しかない）が読めなくなり、文字の可読性の
 * ために別の手がかり（奥行き・ホバーのフィードバック）を壊すことになるため。
 * 0.6 でも4.5:1 を満たさない背景（明るい背景・彩度や明度が近すぎる背景）は
 * 導出を諦め、静的な既定値のまま追従しない（既知の制限）。
 */

import type { TerminalTheme } from './ipc';

/**
 * クロームの面。`styles.css` の `--surface-0`〜`--surface-3` と同じ意味・同じ並び
 * （`src/shared/defaults.ts` の `SURFACE` とも対応する）。
 */
export interface ChromeSurfaces {
  /** サイドバー（最奥）。CSS の --surface-0 */
  surface0: string;
  /**
   * ターミナル背景・ウィンドウ既定。CSS の --surface-1。
   * 常に background そのものと同じ値（Issue #20 の A-2。ターミナル背景に関わる
   * トークンは必ずここから導出し、`.terminal-pane__container` の padding の外周に
   * 色の違う帯を作らない）。
   */
  surface1: string;
  /** 行のホバー。CSS の --surface-2 */
  surface2: string;
  /** 設定ウィンドウ・浮いた面（最前）。CSS の --surface-3 */
  surface3: string;
}

/** `terminalThemeFrom()` の戻り値。ターミナルとクロームを同じ background から一括生成する。 */
export interface DerivedTheme {
  /**
   * xterm の ITheme にそのまま渡せる4色。
   * 呼び出し側（`useTerminal.ts`）は渡された `TerminalTheme` をそのまま
   * `term.options.theme` に渡すだけでよい。CSS は経由しない。
   */
  terminal: TerminalTheme;
  /** クロームの CSS 変数（--surface-0〜3）に流し込む値 */
  chrome: ChromeSurfaces;
  /**
   * `chrome` を実際に CSS 変数へ適用してよいか。
   *
   * false のときは、呼び出し側（`App.tsx`）は `setProperty` を呼ばず、
   * `styles.css` の `:root` が持つ静的な値をそのまま生かす。文字色までは
   * 導出しないため、面だけを明るくすると静的な文字色との contrast が壊れる
   * （`chromeTextRemainsReadable()` 参照）。
   */
  chromeSafeToApply: boolean;
  /**
   * `chrome` の導出に採用されたオフセットの縮小係数（1 / 0.8 / 0.6 のいずれか）。
   * `chromeSafeToApply` が false のときは、どの係数でも基準を満たせなかった
   * ことを表し、この値は undefined になる。
   */
  chromeScale?: ChromeScale;
}

/**
 * `deriveChromeSurfaces()` のオフセットに掛ける縮小係数。
 * 大きい順に試し、最初に3段の文字色が 4.5:1 を満たした係数を採用する
 * （`resolveChromeSurfaces()`）。0.6 が下限（面の段差が読めなくなる手前）。
 */
export type ChromeScale = 1 | 0.8 | 0.6;
const CHROME_SCALES: readonly ChromeScale[] = [1, 0.8, 0.6];

/**
 * 面ごとの明度差（RGB の各チャンネルに足すオフセット）。
 *
 * **既定背景 `#1e1e1e` と、現行の `SURFACE` 定数（`src/shared/defaults.ts`）から
 * 逆算した値。** 既定設定でこの関数を通すと、既存の4面の値と1バイトも変わらない
 * （`test/unit/theme.test.ts` が固定。ここが崩れると画像0枚の前提が崩れる）。
 *
 * #1e1e1e (30,30,30) を基準に:
 * - サイドバー #141414 (20,20,20) = -10
 * - ホバー     #222222 (34,34,34) = +4
 * - 浮いた面   #282828 (40,40,40) = +10
 */
const SURFACE_DELTA = {
  surface0: -10,
  surface2: 4,
  surface3: 10,
} as const;

function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

/**
 * `#rgb` / `#rrggbb` を `[r, g, b]`（0-255）に変換する。
 * パースできない入力は `null` を返す（CLAUDE.md 鉄則5: 外部由来の値の
 * パース失敗でアプリを落とさない。呼び出し側が縮退させる）。
 */
function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) return null;
  const body = match[1];
  const full =
    body.length === 3
      ? body
          .split('')
          .map((c) => c + c)
          .join('')
      : body;
  const num = Number.parseInt(full, 16);
  return [(num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff];
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number): string => clampChannel(n).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * background を基準に、RGB の各チャンネルへ同じオフセット（`SURFACE_DELTA` に
 * `scale` を掛けたもの）を足して面を作る。無彩色（グレー）に対しては明度そのものの
 * 差になり、`scale === 1`（既定）では既定値と厳密に一致する。有彩色に対しても
 * 色相を大きく崩さない範囲で明暗だけを動かす、「明度差で機械的に生成する」の
 * 最も単純な実装。
 *
 * `scale` はオフセットを掛けた後、チャンネルへ足す前に整数へ丸める
 * （`resolveChromeSurfaces()` が 1 / 0.8 / 0.6 を試すために使う）。
 *
 * オフセットが 0-255 の範囲を超える場合はクランプする（縮退。極端に明るい/暗い
 * background でも例外を投げず、面の間の差が詰まるだけにする）。
 *
 * パースできない background は、全面を background のまま返す
 * （見た目は変わらないが、少なくともアプリは落ちない）。
 */
export function deriveChromeSurfaces(background: string, scale: number = 1): ChromeSurfaces {
  const rgb = hexToRgb(background);
  if (!rgb) {
    return {
      surface0: background,
      surface1: background,
      surface2: background,
      surface3: background,
    };
  }
  const [r, g, b] = rgb;
  const shift = (delta: number): string => {
    const scaled = Math.round(delta * scale);
    return rgbToHex(r + scaled, g + scaled, b + scaled);
  };
  return {
    surface0: shift(SURFACE_DELTA.surface0),
    surface1: background,
    surface2: shift(SURFACE_DELTA.surface2),
    surface3: shift(SURFACE_DELTA.surface3),
  };
}

/**
 * クロームの文字色（`styles.css` の `--text-primary` / `--text-secondary` /
 * `--text-tertiary`）。**この PR では静的なまま**（文字色まで導出しない。
 * 導出するのは面だけ）。
 *
 * `styles.css` の宣言と同じ値でなければならない。CSS 変数は Main プロセスから
 * 読めないため、`src/shared/defaults.ts` の `SURFACE` と同じ理由で構造的に
 * 統一できない。ずれていないことは `test/unit/theme.test.ts` が `styles.css`
 * を直接読んで突き合わせる。
 */
export const CHROME_TEXT = {
  primary: '#e6e6e6',
  secondary: '#a8a8a8',
  tertiary: '#949494',
} as const;

/** WCAG 1.4.3（通常テキスト）の最低コントラスト比 */
const MIN_TEXT_CONTRAST = 4.5;

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/**
 * WCAG 2.2 のコントラスト比。式は `e2e/fixtures/contrast.ts` の
 * `measureContrast()` と同じ（相対輝度の係数・`(l1+0.05)/(l2+0.05)`）。
 *
 * **e2e からは import しない。** `src/shared/` は Main / preload / Renderer の
 * いずれからも読まれるが、`e2e/fixtures/contrast.ts` は Playwright の `Page`
 * に依存しており持ち込めない。式だけをここに複製してある。
 *
 * パースできない hex を渡された場合は `1`（コントラストなし = 最も厳しい判定）
 * を返す。呼び出し側が「読めない」を「安全」と誤認しないようにするため。
 */
export function contrastRatio(hexA: string, hexB: string): number {
  const rgbA = hexToRgb(hexA);
  const rgbB = hexToRgb(hexB);
  if (!rgbA || !rgbB) return 1;
  const [l1, l2] = [relativeLuminance(rgbA), relativeLuminance(rgbB)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

/**
 * 導出した面（`surfaces`）の上で、静的な文字色3段（`CHROME_TEXT`）が
 * 引き続き 4.5:1 を保てるかを判定する。
 *
 * **最も明るい面（`surface3`）だけを見る。** Phase 1（Issue #20 の A-3・
 * PR 5）が実測で確かめた通り、明るい文字を暗い面に置く配色では一番明るい面が
 * 一番厳しい判定になる。`surface3` は正の scale であれば `deriveChromeSurfaces()`
 * の構成上つねに最も明るいオフセットを持つため、ここだけ見れば残り3面は
 * 自動的に安全側。
 */
export function chromeTextRemainsReadable(surfaces: ChromeSurfaces): boolean {
  const brightest = surfaces.surface3;
  return (
    contrastRatio(CHROME_TEXT.primary, brightest) >= MIN_TEXT_CONTRAST &&
    contrastRatio(CHROME_TEXT.secondary, brightest) >= MIN_TEXT_CONTRAST &&
    contrastRatio(CHROME_TEXT.tertiary, brightest) >= MIN_TEXT_CONTRAST
  );
}

/**
 * `theme.background` から、実際に CSS へ適用してよいクロームの面を決める。
 *
 * オフセットの縮小係数を `CHROME_SCALES`（1 -> 0.8 -> 0.6）の順に試し、
 * **最初に3段の文字色すべてが 4.5:1 を満たした係数**を採用する
 * （`chromeTextRemainsReadable()`）。0.6 でも満たさない背景（明るい背景・
 * 彩度や明度が文字色に近すぎる背景）は導出を諦める。
 *
 * 既定背景（`#1e1e1e`）は scale = 1 でそのまま満たすため、`chrome` は
 * `deriveChromeSurfaces()` の既定出力（= 既存の `SURFACE` 定数）と一致し続ける。
 */
export function resolveChromeSurfaces(background: string): {
  chrome: ChromeSurfaces;
  chromeSafeToApply: boolean;
  chromeScale?: ChromeScale;
} {
  for (const scale of CHROME_SCALES) {
    const chrome = deriveChromeSurfaces(background, scale);
    if (chromeTextRemainsReadable(chrome)) {
      return { chrome, chromeSafeToApply: true, chromeScale: scale };
    }
  }
  // どの係数でも満たさない。呼び出し側は適用しない前提だが、参照用に
  // scale=1（無加工のオフセット）の導出結果を返しておく。
  return { chrome: deriveChromeSurfaces(background, 1), chromeSafeToApply: false };
}

/**
 * ターミナルの ITheme（4色）とクロームの面を、同じ `theme.background` から一括生成する。
 *
 * `terminal` は受け取った `theme` をそのまま返すだけ（このファイルが CSS を
 * 経由せず直接 TS のパレットとして渡すことが鉄則2の境界を守るために重要）。
 * `chrome` / `chromeSafeToApply` / `chromeScale` は `resolveChromeSurfaces()` の
 * 結果をそのまま載せる。
 */
export function terminalThemeFrom(theme: TerminalTheme): DerivedTheme {
  const { chrome, chromeSafeToApply, chromeScale } = resolveChromeSurfaces(theme.background);
  return {
    terminal: theme,
    chrome,
    chromeSafeToApply,
    chromeScale,
  };
}
