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
 * 固定の agents.json は demo-project-busy（status: busy）と other-project-idle（status: idle）の
 * 2件を返す（harness.ts）。
 *
 * CLI の語と、人間から見た意味は逆になる:
 *   busy = エージェントが動いている  -> 人間は待たなくてよい -> task-item--working
 *   idle = エージェントが止まっている -> あなたの番           -> task-item--your-turn
 *
 * このテストの主眼は「2件が区別されること」ではなく、**強調されているのが
 * 「あなたの番」の側であること**。ここが逆転すると、放っておいてよい行だけが
 * 光る状態に戻る（Issue #21）。
 */
test('S12 実行中タスクが一覧に表示され、状態で区別される', async () => {
  const { window } = launched;

  // サイドバーは既定でタスクタブだが、明示的に切り替えておく
  await window.locator('.sidebar__tabs button', { hasText: 'タスク' }).click();

  const items = window.locator('.task-list .task-item');
  await expect(items).toHaveCount(2, { timeout: 15_000 });

  const yourTurnItem = window.locator('.task-item--your-turn');
  const workingItem = window.locator('.task-item--working');
  await expect(yourTurnItem).toHaveCount(1);
  await expect(workingItem).toHaveCount(1);

  // CLI の status と、アプリ側の意味の対応が逆になっていないこと
  await expect(workingItem.locator('.task-item__name')).toContainText('demo-project-busy');
  await expect(yourTurnItem.locator('.task-item__name')).toContainText('other-project-idle');

  // 状態が日本語の語でも示されていること（色だけに依存しない）
  await expect(yourTurnItem.locator('.task-item__state')).toHaveText('あなたの番');
  await expect(workingItem.locator('.task-item__state')).toHaveText('作業中');

  // CLI が返した生の値も残っていること（鉄則4/5: CLI が言ったことを隠さない）
  await expect(yourTurnItem.locator('.task-item__raw-status')).toHaveText('idle');
  await expect(workingItem.locator('.task-item__raw-status')).toHaveText('busy');

  // 視覚的な区別: status-dot の背景色が異なること
  const yourTurnColor = await yourTurnItem
    .locator('.task-item__status-dot')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  const workingColor = await workingItem
    .locator('.task-item__status-dot')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(yourTurnColor).not.toBe(workingColor);

  // **強調されているのは「あなたの番」の側**であること。
  // グロー（box-shadow）を持つのは your-turn だけで、working は持たない。
  // 色を入れ替えて戻すと、ここが赤くなる。
  const yourTurnShadow = await yourTurnItem
    .locator('.task-item__status-dot')
    .evaluate((el) => getComputedStyle(el).boxShadow);
  const workingShadow = await workingItem
    .locator('.task-item__status-dot')
    .evaluate((el) => getComputedStyle(el).boxShadow);
  expect(yourTurnShadow).not.toBe('none');
  expect(workingShadow).toBe('none');

  // クラス名自体でも区別されていること
  await expect(yourTurnItem).not.toHaveClass(/task-item--working/);
  await expect(workingItem).not.toHaveClass(/task-item--your-turn/);
});
