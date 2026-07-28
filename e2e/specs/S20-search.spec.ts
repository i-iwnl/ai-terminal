import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

test('S20 検索 UI を開ける', async () => {
  const { window } = launched;

  // シェルが起動し、ターミナルにフォーカスがある状態にする
  const screen = window.locator('.terminal-pane__container .xterm-screen').first();
  await expect(screen).toContainText(/[$%#>]/, { timeout: 20_000 });
  await window.locator('.xterm-helper-textarea').first().focus();

  await expect(window.locator('.terminal-search')).toBeHidden();

  await window.keyboard.press('Meta+f');
  await expect(window.locator('.terminal-search')).toBeVisible();

  // 検索ボタン（前を検索 / 次を検索 / 検索を閉じる）が存在すること
  await expect(window.locator('.terminal-search button[title="前を検索"]')).toBeVisible();
  await expect(window.locator('.terminal-search button[title="次を検索"]')).toBeVisible();
  const closeButton = window.locator('.terminal-search button[title="検索を閉じる"]');
  await expect(closeButton).toBeVisible();

  // 閉じられること
  await closeButton.click();
  await expect(window.locator('.terminal-search')).toBeHidden();
});
