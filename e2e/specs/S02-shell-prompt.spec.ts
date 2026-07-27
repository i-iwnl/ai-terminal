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
 * preload の読み込みに失敗すると window.api が生えず、PTY が一切起動しない。
 * その状態でもウィンドウ自体は開くため「起動した」だけでは検出できない。
 * 実際にこの不具合を作り込んだことがあるので、シェルが応答するところまで見る。
 */
test('S02 シェルが起動してプロンプトが表示される', async () => {
  const { window } = launched;

  // preload が読み込まれ、contextBridge の API が露出していること
  const hasApi = await window.evaluate(() => typeof window.api === 'object' && window.api !== null);
  expect(hasApi).toBe(true);

  // PTY からの出力が xterm に描画されること（プロンプト記号が出るまで待つ）
  const screen = window.locator('.terminal-pane__container .xterm-screen').first();
  await expect(screen).toBeVisible();
  await expect(screen).toContainText(/[$%#>]/, { timeout: 20_000 });
});
