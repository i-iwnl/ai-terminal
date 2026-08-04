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
 * Issue #20 I-1（PR 12）。
 *
 * `TabBar` の「+」は `newShellTab` 固定で、`newAgentTab` を呼べるのは
 * メニュー（menu.ts）と `Cmd+Shift+C` / `Cmd+Shift+E` だけだった。説明書を
 * 読まない初見ユーザーがこのアプリの存在理由（AI CLI を飼う）へ画面上から
 * 到達する手段が無かったため、「+」を分割ボタン（+ ▾）にする。
 */
test('S64 「+ ▾」で新しいシェル / Claude / Gemini を選んで開ける', async () => {
  const { window } = launched;

  const newButton = window.locator('button[aria-label="新しいタブを開く"]');
  const menu = window.locator('.tab-bar__new-menu');
  const tabs = window.locator('.tab-bar__tab');

  await expect(tabs).toHaveCount(1);
  await expect(menu).toHaveCount(0);
  await expect(newButton).toHaveAttribute('aria-expanded', 'false');

  // メニューを開くと3項目（シェル / Claude / Gemini）が並ぶこと。
  // **3つとも裸の名詞**（Issue #137。以前は1つ目だけ「新しいシェル」だった）。
  await newButton.click();
  await expect(menu).toBeVisible();
  await expect(newButton).toHaveAttribute('aria-expanded', 'true');
  const items = menu.locator('[role="menuitem"]');
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toHaveText('シェル');
  await expect(items.nth(1)).toHaveText('Claude');
  await expect(items.nth(2)).toHaveText('Gemini');

  // 開いたら最初の項目にフォーカスが移ること（WAI-ARIA APG のメニューボタンパターン）。
  expect(await items.nth(0).evaluate((el) => el === document.activeElement)).toBe(true);

  // Escape で閉じ、トリガーへフォーカスが戻ること。
  await window.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  expect(await newButton.evaluate((el) => el === document.activeElement)).toBe(true);

  // 外側クリックでも閉じること。
  await newButton.click();
  await expect(menu).toBeVisible();
  await window.locator('.tab-bar__drag-region').click({ position: { x: 5, y: 5 } });
  await expect(menu).toHaveCount(0);

  // 「Claude」を選ぶと claude タブが開くこと。
  await newButton.click();
  await menu.locator('[role="menuitem"]', { hasText: 'Claude' }).click();
  await expect(menu).toHaveCount(0);
  await expect(tabs).toHaveCount(2);
  await expect(window.locator('.tab-bar__tab--claude')).toHaveCount(1);
  const claudeScreen = window.locator('.terminal-pane:not(.terminal-pane--hidden) .xterm-rows').first();
  await expect(claudeScreen).toContainText('FAKE CLAUDE READY', { timeout: 20_000 });

  // 「Gemini」を選ぶと gemini タブが開くこと。
  await newButton.click();
  await expect(menu).toBeVisible();
  await menu.locator('[role="menuitem"]', { hasText: 'Gemini' }).click();
  await expect(tabs).toHaveCount(3);
  await expect(window.locator('.tab-bar__tab--gemini')).toHaveCount(1);
  const geminiScreen = window.locator('.terminal-pane:not(.terminal-pane--hidden) .xterm-rows').first();
  await expect(geminiScreen).toContainText('FAKE GEMINI READY', { timeout: 20_000 });
});
