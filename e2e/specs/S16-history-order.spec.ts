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
 * harness.ts が配置する3件の履歴は、mtime が新しい順に
 * 「壊れたもの（33333333）」「タイトル無し（22222222）」「正常（11111111）」となる。
 * 履歴一覧はこの降順で並ぶはず。
 */
test('S16 履歴が更新時刻の降順で表示される', async () => {
  const { window } = launched;

  await window.locator('.sidebar__tabs button', { hasText: '履歴' }).click();

  const items = window.locator('.history-item');
  await expect(items).toHaveCount(3);

  // 壊れたエントリは sessionId の先頭8文字で表示される（S18 参照）
  await expect(items.nth(0)).toContainText('33333333');
  // タイトル無しエントリは最初のプロンプトで表示される（S17 参照）
  await expect(items.nth(1)).toContainText('タブの切り替えでフォーカスが外れる問題を調べて');
  // 正常なエントリは ai-title のタイトルで表示される
  await expect(items.nth(2)).toContainText('サイドバーのレイアウト修正');
});
