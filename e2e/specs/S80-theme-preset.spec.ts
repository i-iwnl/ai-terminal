import { test, expect } from '@playwright/test';
import { launchApp, closeApp, openSettingsWindow, type LaunchedApp } from '../fixtures/harness';

/**
 * Issue #119 の周6（#20 の PR 18）。配色プリセットの切り替え。
 *
 * ## 何を守るか
 *
 * `src/shared/theme.ts` が「`theme.background` からクロームの面を導出する」
 * 仕組みを PR #101 で入れていたが、**切り替える UI が無かった**ので、
 * テーマを変える手段は `config.json` の直接編集だけだった。
 *
 * ここで見るのは「**ターミナルとクロームが一緒に変わる**」こと。
 * 片方だけ変わる状態（= `chromeSafeToApply` が false のときに起きる半適用）が
 * この機能の主な故障モードで、プリセットに閉じた理由そのもの。
 *
 * ## 自由入力にしない理由
 *
 * `useTerminal.ts` は `chromeSafeToApply` を見ずに `term.options.theme` を
 * **無条件に適用する**一方、`App.tsx` はクロームの面の適用を**見送る**。
 * 任意の色を選べると「端末だけ明るくなり、クロームが暗いまま残る」半適用になる。
 * プリセットが安全であることは `test/unit/themes.test.ts` が関門にしている
 * （Nord / Dracula / One Dark / Gruvbox Dark は実測で全滅した）。
 *
 * ## `S21-config.spec.ts` を壊していないこと
 *
 * `themeName` が未設定なら**保存済みの `theme`（4色）が勝つ**設計にしてある。
 * S21 は `config.json` に `theme.background` を直接書いて反映を見るシナリオで、
 * 逆の優先順位にすると確実に落ちる（**手で書いた設定が黙って無視される**のは
 * 利用者から見て「壊れた」以外の何物でもない）。その保証は S21 自身が担う。
 */

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

test('S80 配色プリセットを選ぶと、ターミナルとクロームが一緒に変わる', async () => {
  const { window } = launched;

  const screen = window.locator('.terminal-pane__container .xterm-screen').first();
  await expect(screen).toContainText(/[$%#>]/, { timeout: 20_000 });

  /** クロームの面と xterm の背景を一度に読む */
  const readColors = async (): Promise<{ surface0: string; surface1: string; xterm: string }> =>
    window.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      // **`.xterm-viewport` では取れない**（`rgb(0,0,0)` を返す）。
      // xterm は ITheme の background を `.xterm-scrollable-element` の
      // インラインスタイルとして書く（S21 が同じ要素を見ている）。
      const scrollable = document.querySelector(
        '.terminal-pane__container .xterm-scrollable-element',
      );
      return {
        surface0: root.getPropertyValue('--surface-0').trim(),
        surface1: root.getPropertyValue('--surface-1').trim(),
        xterm: scrollable ? getComputedStyle(scrollable).backgroundColor : '',
      };
    });

  const before = await readColors();
  // 既定は #1e1e1e / #141414（styles.css の静的な値と一致する）。
  expect(before.surface1).toBe('#1e1e1e');
  expect(before.surface0).toBe('#141414');

  // --- 設定ウィンドウでプリセットを選ぶ ---------------------------------------
  const settings = await openSettingsWindow(launched, async () => {
    await window.locator('.tab-bar__settings').click();
  });

  const select = settings.locator('.settings__row', { hasText: '配色' }).locator('select');
  await expect(select).toHaveCount(1);
  // 既定の選択は「既定（ダーク）」（保存済みの4色が既定と一致するため）。
  await expect(select).toHaveValue('default');

  await select.selectOption('tokyo-night');

  // --- 本体ウィンドウへ届き、両方が変わる -------------------------------------
  // 設定ウィンドウは別の Renderer なので、Main の broadcastConfig 経由で届く。
  await expect
    .poll(async () => (await readColors()).surface1, { timeout: 15_000 })
    .toBe('#1a1b26');

  const after = await readColors();
  // **クロームの面が導出されて変わっている。**
  expect(after.surface0, 'サイドバーの面も追従する').not.toBe(before.surface0);
  // **ターミナルの背景も一緒に変わっている。** ここが片方だけだと半適用。
  expect(after.xterm, 'ターミナルの背景も変わる').not.toBe(before.xterm);
  expect(after.xterm).toBe('rgb(26, 27, 38)');

  // --- 既定へ戻せる -----------------------------------------------------------
  await select.selectOption('default');
  await expect
    .poll(async () => (await readColors()).surface1, { timeout: 15_000 })
    .toBe('#1e1e1e');
  // **インライン値が残らない**（Issue #119 周6 で直したバグ。以前は
  // `chromeSafeToApply` が false のときに `return` するだけで、前のテーマの
  // 面が `document.documentElement.style` に残り続けていた）。
  const restored = await readColors();
  expect(restored.surface0).toBe(before.surface0);
  expect(restored.xterm).toBe(before.xterm);
});
