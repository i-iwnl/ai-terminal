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
 * 履歴（正常なエントリ 11111111-...）をクリックすると、新しいタブが開き
 * claude が --resume <sessionId> 付きで起動される。
 * 偽 claude は対話起動時に受け取った引数を "ARGS: ..." として出力するので、
 * それを画面上で確認する。
 */
test('S19 履歴をクリックすると resume 付きでタブが開く', async () => {
  const { window } = launched;

  await window.locator('.sidebar__tabs button', { hasText: '履歴' }).click();

  const tabsBefore = window.locator('.tab-bar__tab');
  const countBefore = await tabsBefore.count();

  const normal = window.locator('.history-item', { hasText: 'サイドバーのレイアウト修正' });
  await expect(normal).toHaveCount(1);
  await normal.click();

  // 新しいタブが開くこと
  await expect(window.locator('.tab-bar__tab')).toHaveCount(countBefore + 1);

  const screen = window.locator('.terminal-pane__container .xterm-screen').last();
  await expect(screen).toContainText('FAKE CLAUDE READY', { timeout: 20_000 });
  await expect(screen).toContainText(/ARGS:.*--resume/, { timeout: 20_000 });
  await expect(screen).toContainText('11111111-1111-4111-8111-111111111111');
});
