import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/harness';

test('S13 実行中タスクが0件のとき空状態が表示される', async () => {
  const launched = await launchApp({ agentsEmpty: true });
  try {
    const { window } = launched;

    await window.locator('.sidebar__tabs button', { hasText: 'タスク' }).click();

    await expect(window.locator('.task-list .task-item')).toHaveCount(0);
    await expect(window.locator('.task-list .panel-message')).toBeVisible();
    await expect(window.locator('.task-list .panel-message')).toContainText(
      '実行中のタスクはありません',
    );

    // エラー表示ではないこと
    await expect(window.locator('.panel-message--error')).toHaveCount(0);
  } finally {
    await closeApp(launched);
  }
});
