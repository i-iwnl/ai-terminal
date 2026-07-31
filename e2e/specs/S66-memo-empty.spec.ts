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
 * Issue #20 I-3。
 *
 * メモタブの空状態（対象未選択）は「履歴一覧の『メモ』ボタンから、セッションごとの
 * メモを開けます」とだけ案内していたが、履歴タブを一度も開いていない利用者には
 * その行の存在自体が分からない循環参照だった。「履歴を見る」ボタンで履歴タブへ
 * 直接飛べるようにする。
 */
test('S66 メモの空状態から履歴タブへ飛べ、循環参照が解消されている', async () => {
  const { window } = launched;

  await window.locator('.sidebar__tabs button', { hasText: 'メモ' }).click();

  const empty = window.locator('.memo-panel__empty');
  await expect(empty).toBeVisible();
  await expect(empty).toContainText('過去のセッションを開いて「メモ」を押すと、ここに残ります');

  const gotoHistory = empty.locator('.memo-panel__goto-history');
  await expect(gotoHistory).toBeVisible();
  await expect(gotoHistory).toContainText('履歴を見る');

  await gotoHistory.click();

  // 履歴タブへ切り替わり、実際に履歴一覧（メモボタンの本来の入口）が見えること。
  await expect(window.locator('.history-list')).toBeVisible();
  await expect(window.locator('.sidebar__tabs button', { hasText: '履歴' })).toHaveClass(
    /is-active/,
  );
  const items = window.locator('.history-item');
  await expect(items).toHaveCount(3);
  await expect(items.first().locator('button[aria-label="メモを開く"]')).toHaveCount(1);
});
