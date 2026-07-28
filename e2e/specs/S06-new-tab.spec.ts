import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

test('S06 新しいシェルタブを開ける', async () => {
  const { window } = launched;

  // 起動直後に開く最初のシェルタブが表示されるまで待つ。
  const tabs = window.locator('.tab-bar__tabs > .tab-bar__tab');
  await expect(tabs).toHaveCount(1);

  // ショートカット（Cmd+T）でタブを増やす。
  await window.keyboard.press('Meta+t');
  await expect(tabs).toHaveCount(2);

  // ボタンからも増やせることを確認する。
  await window.locator('button[aria-label="新しいシェルタブ"]').click();
  await expect(tabs).toHaveCount(3);

  // 新しいタブが選択状態（is-active）になっていること。
  await expect(tabs.last()).toHaveClass(/is-active/);
});
