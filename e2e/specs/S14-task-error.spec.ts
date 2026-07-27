import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/harness';

test('S14 タスク一覧の取得に失敗してもエラー表示になり画面が壊れない', async () => {
  const launched = await launchApp({ agentsFail: true });
  try {
    const { window } = launched;

    await window.locator('.sidebar__tabs button', { hasText: 'タスク' }).click();

    const errorMessage = window.locator('.task-list .panel-message--error');
    await expect(errorMessage).toBeVisible({ timeout: 15_000 });
    await expect(errorMessage).toContainText('タスク一覧の取得に失敗しました');

    // 画面が壊れていないこと（サイドバー・タブバー・ターミナルが引き続き存在する）
    await expect(window.locator('.app')).toBeVisible();
    await expect(window.locator('.sidebar')).toBeVisible();
    await expect(window.locator('.tab-bar')).toBeVisible();
    const screen = window.locator('.terminal-pane__container .xterm-screen').first();
    await expect(screen).toBeVisible();
    // xterm.js の DOM レンダラが .xterm-screen 配下に注入する <style> の中身まで
    // textContent ベースの既定の toContainText は拾ってしまうため、useInnerText を使う。
    await expect(screen).toContainText(/[$%#>]/, { timeout: 20_000, useInnerText: true });
  } finally {
    await closeApp(launched);
  }
});
