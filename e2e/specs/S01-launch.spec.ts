import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

test('S01 アプリが起動し、サイドバーとターミナルが表示される', async () => {
  const { window } = launched;

  await expect(window.locator('.app')).toBeVisible();
  await expect(window.locator('.sidebar')).toBeVisible();
  await expect(window.locator('.tab-bar')).toBeVisible();
  await expect(window.locator('.terminal-stack')).toBeVisible();

  // xterm がマウントされ、描画用の要素が生成されていること
  await expect(window.locator('.terminal-pane__container .xterm').first()).toBeVisible();
});
