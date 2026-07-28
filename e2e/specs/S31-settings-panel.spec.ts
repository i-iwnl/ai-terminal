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
 * 設定パネルの開閉と、変更が実際に効くことを検証する。
 *
 * S21 は config.json をあらかじめ書いた状態で起動して反映を見ているが、
 * こちらは **アプリを起動したまま画面から変えて反映されるか** を見る。
 * config:set の往復と、返ってきた設定での再描画までが対象。
 *
 * フォントサイズを判定材料に選んだのは、xterm の描画に伝わったことが
 * DOM の computed style で確認できるため（色は S21 が見ている）。
 */
test('S31 設定パネルから変更するとターミナルに反映される', async () => {
  const { window } = launched;

  const rows = window.locator('.terminal-pane__container .xterm-rows').first();
  await expect(rows).toBeVisible();
  const before = await rows.evaluate((el) => getComputedStyle(el).fontSize);

  // タブバーの「設定」ボタンで開く
  await window.locator('button[aria-label="設定を開く"]').click();
  const dialog = window.locator('[role="dialog"][aria-label="設定"]');
  await expect(dialog).toBeVisible();

  // 通知音の一覧が取れていること（macOS のシステムサウンドが読める）。
  // 「OS 既定」だけの環境もありうるので、件数ではなく先頭の選択肢の性質で見る。
  const soundSelect = dialog.locator('select[aria-label="通知音"]');
  await expect(soundSelect).toHaveValue('');

  // フォントサイズを既定（13）と違う値に変える
  const fontSize = dialog.locator('input[type="number"]').first();
  await fontSize.fill('22');
  await fontSize.blur();

  await expect(async () => {
    const after = await rows.evaluate((el) => getComputedStyle(el).fontSize);
    expect(after).toBe('22px');
  }).toPass({ timeout: 20_000 });
  expect(before).not.toBe('22px');

  // Escape で閉じる
  await window.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // Cmd+, で開き直すと、変更した値が保持されている
  await window.keyboard.press('Meta+,');
  await expect(window.locator('[role="dialog"][aria-label="設定"]')).toBeVisible();
  await expect(window.locator('[role="dialog"] input[type="number"]').first()).toHaveValue('22');

  // 背景クリックでも閉じる
  await window.locator('.settings-backdrop').click({ position: { x: 5, y: 5 } });
  await expect(window.locator('[role="dialog"][aria-label="設定"]')).toHaveCount(0);
});
