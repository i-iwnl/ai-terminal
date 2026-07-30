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
 * 2件を返す（harness.ts）。**フィクスチャの定義順は busy が先。**
 *
 * CLI の語と、人間から見た意味は逆になる:
 *   busy = エージェントが動いている  -> 人間は待たなくてよい -> task-item--working
 *   idle = エージェントが止まっている -> あなたの番           -> task-item--your-turn
 *
 * このテストの主眼は「2件が区別されること」ではなく、**強調されているのが
 * 「あなたの番」の側であること**。ここが逆転すると、放っておいてよい行だけが
 * 光る状態に戻る（Issue #21）。
 *
 * Issue #20 B（PR 8: タスク行の再設計）の3点もここで確認する:
 * - 状態語は行の左（.task-item__name の先頭）に置く
 * - グループ見出しで区切る（ソートだけでは境界が視覚以外に伝わらない）
 * - 並び順は CLI が返した順ではなく「あなたの番」が先頭
 *
 * 「待たせている時間」（yourTurnSince）はこのテストでは検証しない。
 * 固定フィクスチャは busy -> idle の遷移が一度も起きないため、poller.ts の
 * 遷移検知が働かず yourTurnSince は常に undefined のまま
 * （= セッション起動からの通算 formatElapsed にフォールバックし続ける、
 * 期待どおりの縮退表示）。遷移そのものの検証は poller 側の単体テストが担う。
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

  // Issue #20 B: 状態語は行の左（.task-item__name の先頭）に置く。
  // 走査は左から右なので、色だけでなく語も真っ先に読めること。
  const yourTurnNameText = await yourTurnItem.locator('.task-item__name').innerText();
  expect(yourTurnNameText.startsWith('あなたの番')).toBe(true);
  const workingNameText = await workingItem.locator('.task-item__name').innerText();
  expect(workingNameText.startsWith('作業中')).toBe(true);

  // グループ見出しで区切られていること。色相の違いは手がかりに数えない、という
  // 原則に従い、色・形（見出しの区切り）・語の3つが独立に同じ情報を運ぶ。
  const headings = window.locator('.task-group__heading');
  await expect(headings).toHaveCount(2);
  await expect(headings.nth(0)).toHaveText('あなたの番 1件');
  await expect(headings.nth(1)).toHaveText('作業中 1件');

  // 並び順: フィクスチャの定義順（busy が先）に関わらず、「あなたの番」の
  // グループが先頭に来ること。CLI が返した順のままだと、あなたの番が
  // 一覧の下に沈んで見落とされる（Issue #20 B）。
  const groupOrder = await window.locator('.task-group').evaluateAll((groups) =>
    groups.map((g) => (g.querySelector('.task-item--your-turn') ? 'your-turn' : 'working')),
  );
  expect(groupOrder).toEqual(['your-turn', 'working']);
});
