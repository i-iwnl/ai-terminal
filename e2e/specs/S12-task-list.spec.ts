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
 * 固定の agents.json は demo-project-busy（busy）と other-project-idle（idle）の
 * 2件を返す（harness.ts）。TaskList.tsx は task-item--busy / task-item--idle の
 * クラスを付け、styles.css がそれぞれ異なる色（busy: オレンジ + box-shadow,
 * idle: 緑）を .task-item__status-dot に当てて視覚的に区別している。
 */
test('S12 実行中タスクが一覧に表示され、状態で区別される', async () => {
  const { window } = launched;

  // サイドバーは既定でタスクタブだが、明示的に切り替えておく
  await window.locator('.sidebar__tabs button', { hasText: 'タスク' }).click();

  const items = window.locator('.task-list .task-item');
  await expect(items).toHaveCount(2, { timeout: 15_000 });

  const busyItem = window.locator('.task-item--busy');
  const idleItem = window.locator('.task-item--idle');
  await expect(busyItem).toHaveCount(1);
  await expect(idleItem).toHaveCount(1);

  await expect(busyItem.locator('.task-item__name')).toContainText('demo-project-busy');
  await expect(idleItem.locator('.task-item__name')).toContainText('other-project-idle');

  // 状態を表す文字列自体も表示されていること
  await expect(busyItem.locator('.task-item__meta')).toContainText('busy');
  await expect(idleItem.locator('.task-item__meta')).toContainText('idle');

  // 視覚的な区別: status-dot の背景色が busy / idle で異なること
  const busyColor = await busyItem
    .locator('.task-item__status-dot')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  const idleColor = await idleItem
    .locator('.task-item__status-dot')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(busyColor).not.toBe(idleColor);

  // クラス名自体でも区別されていること
  await expect(busyItem).not.toHaveClass(/task-item--idle/);
  await expect(idleItem).not.toHaveClass(/task-item--busy/);
});
