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
 * 絞り込みを、アプリを起動したまま設定パネルから切り替える経路。
 *
 * S34 は config.json に書かれた状態で起動して結果を見るが、**ユーザーが実際に使うのは
 * こちら**。設定の変更が次のポーリングに乗ることまでが対象。
 *
 * 往復させる（有効 -> 無効）。片道だけだと、絞り込みが一度効いたまま戻らない不具合を
 * 緑のまま通してしまう。
 */
test('S35 設定パネルで絞り込みを切り替えると、次のポーリングで反映される', async () => {
  const { window } = launched;

  await window.locator('.sidebar__tabs button', { hasText: 'タスク' }).click();
  const items = window.locator('.task-list .task-item');
  await expect(items).toHaveCount(2, { timeout: 15_000 });

  await window.locator('button[aria-label="設定を開く"]').click();
  const dialog = window.locator('[role="dialog"][aria-label="設定"]');
  await expect(dialog).toBeVisible();

  // check() / uncheck() は使わない。この画面のチェックボックスは
  // config:set の往復が返ってから再描画される制御コンポーネントなので、
  // クリック直後の状態を見に行く check() は「状態が変わらなかった」と判定して落ちる。
  const scopeBox = dialog
    .locator('label', { hasText: 'タスク一覧を現在のディレクトリに絞り込む' })
    .locator('input[type="checkbox"]');
  await expect(scopeBox).not.toBeChecked();
  await scopeBox.click();
  await expect(scopeBox).toBeChecked();
  await window.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  await expect(items).toHaveCount(1, { timeout: 15_000 });
  await expect(items.first()).toContainText('demo-project-busy');

  // 戻せば元に戻る（片道だけの検証にしない）
  await window.locator('button[aria-label="設定を開く"]').click();
  const reopened = window
    .locator('[role="dialog"] label', { hasText: 'タスク一覧を現在のディレクトリに絞り込む' })
    .locator('input[type="checkbox"]');
  // 開き直しても設定が残っていること（保存されている確認も兼ねる）
  await expect(reopened).toBeChecked();
  await reopened.click();
  await expect(reopened).not.toBeChecked();
  await window.keyboard.press('Escape');

  await expect(items).toHaveCount(2, { timeout: 15_000 });
});
