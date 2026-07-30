import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

/**
 * Issue #65 の再発防止。
 *
 * タブの切り替えは長らく `Cmd+1`〜`Cmd+9` しか無く、**10枚目以降のタブには
 * キーボードから到達できなかった**。Issue #20 の PR 9（PR #86）で入れた
 * role="tablist" + roving tabindex がこれを解消している。
 *
 * S51 は3枚での roving tabindex の挙動そのものを見るが、**枚数が増えて
 * タブバーが横スクロールに入ったときに、フォーカスした要素が画面外に
 * 出たままにならないか**は見ていない。ここはコード読解では潰せないので、
 * 実際に12枚開いて `toBeInViewport()` まで確認する。
 *
 * `nextRovingTabindex` の添字計算自体は test/unit/roving-tabindex.test.ts が
 * 枚数によらず固定しているので、ここで見るのは「実画面で本当に届くか」だけ。
 */
test('S54 タブが10枚を超えてもキーボードだけで最後のタブへ到達できる', async () => {
  const { window } = launched;

  const tabs = window.locator('.tab-bar__tab');
  await expect(tabs).toHaveCount(1);

  // 合計12枚にする（Cmd+1-9 では届かない範囲を確実に作る）。
  for (let i = 0; i < 11; i += 1) {
    await window.keyboard.press('Meta+t');
  }
  await expect(tabs).toHaveCount(12, { timeout: 20_000 });

  const tabButtons = window.locator('.tab-bar__tab-button');
  const isFocused = (loc: typeof tabButtons) =>
    loc.evaluate((el) => el === document.activeElement);

  // 12枚目（最後に開いたもの）が選択中。まず1枚目を選択中の状態にしておく。
  await window.keyboard.press('Meta+1');
  await expect(tabs.nth(0)).toHaveClass(/is-active/);

  // キーボードだけでタブバーへ入る。
  await window.locator('.tab-bar__new').focus();
  await expect(tabButtons.nth(0)).toHaveAttribute('tabindex', '0');
  await window.keyboard.press('Shift+Tab');
  expect(await isFocused(tabButtons.nth(0)), 'Shift+Tab で選択中（1枚目）へ到達する').toBe(true);

  // End で最後（12枚目）へ。ここが #65 の本題。
  await window.keyboard.press('End');
  expect(await isFocused(tabButtons.nth(11)), 'End で12枚目へフォーカスが移る').toBe(true);

  // 画面外に隠れていないこと（横スクロールしていてもスクロールインされていること）。
  await expect(tabButtons.nth(11)).toBeInViewport();

  // manual activation なのでまだ切り替わっていない。
  await expect(tabButtons.nth(11)).toHaveAttribute('aria-selected', 'false');

  // Enter で初めて切り替わる。
  await window.keyboard.press('Enter');
  await expect(tabs.nth(11)).toHaveClass(/is-active/);
  await expect(tabButtons.nth(11)).toHaveAttribute('aria-selected', 'true');

  // 矢印キーでも10枚目・11枚目へ届くこと（End だけの特殊解ではないことの確認）。
  await window.locator('.tab-bar__new').focus();
  await window.keyboard.press('Shift+Tab');
  await window.keyboard.press('ArrowLeft');
  expect(await isFocused(tabButtons.nth(10)), 'ArrowLeft で11枚目へ').toBe(true);
  await expect(tabButtons.nth(10)).toBeInViewport();
  await window.keyboard.press('ArrowLeft');
  expect(await isFocused(tabButtons.nth(9)), 'ArrowLeft で10枚目へ').toBe(true);
  await expect(tabButtons.nth(9)).toBeInViewport();
  await window.keyboard.press('Enter');
  await expect(tabs.nth(9)).toHaveClass(/is-active/);
});
