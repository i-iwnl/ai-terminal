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
 * 全体メモが Main 側（~/.ai-terminal/memos.json）に保存され、
 * パネルを開き直しても残ることを検証する。
 *
 * 「入力欄に文字が入った」だけでは、React の state に入っただけで保存されて
 * いなくても緑になる。サイドバーのタブを切り替えて MemoPanel を一度アンマウント
 * させ、再マウント時の memo:list で取り直した値を見ることで、IPC 越しの往復を
 * 通ったことまで担保する。
 */
test('S29 全体メモを書くと保存され、開き直しても残る', async () => {
  const { window } = launched;

  const memoTab = window.locator('.sidebar__tabs button', { hasText: 'メモ' });
  await memoTab.click();

  const globalMemo = window.locator('textarea[aria-label="全体メモ"]');
  await expect(globalMemo).toBeVisible();
  // 初期状態は空（前の実行の残りを拾って誤って緑にならないことの確認も兼ねる）
  await expect(globalMemo).toHaveValue('');

  const body = 'E2E-GLOBAL-MEMO\n2行目も残ること';
  await globalMemo.fill(body);
  // blur で保存が確定する（入力停止後の自動保存を待たずに済ませる）
  await window.locator('.sidebar__tabs button', { hasText: 'タスク' }).click();
  await expect(globalMemo).toHaveCount(0);

  // 開き直すと Main から取り直した値が入っている
  await memoTab.click();
  await expect(window.locator('textarea[aria-label="全体メモ"]')).toHaveValue(body);

  // 全部消すとメモも消える（空のメモが残り続けない）
  const reopened = window.locator('textarea[aria-label="全体メモ"]');
  await reopened.fill('');
  await window.locator('.sidebar__tabs button', { hasText: 'タスク' }).click();
  await memoTab.click();
  await expect(window.locator('textarea[aria-label="全体メモ"]')).toHaveValue('');
});
