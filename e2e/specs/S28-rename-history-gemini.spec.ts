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
 * gemini 側の履歴一覧でもタイトルのインライン編集ができ、ツールバーの「更新」を
 * 挟んでも上書きタイトルが維持されることを検証する。
 *
 * gemini は claude と違い、保存キー（stableId）に sessionId ではなく
 * `--list-sessions` 行末の内部 UUID を使う（e2e/fixtures/gemini-sessions.txt を
 * 参照。行の並び順は変わらないため、対象行の特定は本文一致ではなく並び順（nth）で
 * 行う。
 */
test('S28 gemini の履歴もタイトル編集が更新後も維持される', async () => {
  const { window } = launched;

  await window.locator('.sidebar__tabs button', { hasText: '履歴' }).click();
  await window.locator('.history-list__providers button', { hasText: 'Gemini' }).click();

  const items = window.locator('.history-item');
  await expect(items).toHaveCount(2);
  const target = items.nth(0);

  const titleEl = target.locator('.history-item__title');
  const editButton = target.locator('button.history-item__edit');
  const input = target.locator('input.history-item__title-input');

  const originalTitle = ((await titleEl.textContent()) ?? '').trim();
  expect(originalTitle.length).toBeGreaterThan(0);

  const tabs = window.locator('.tab-bar__tab');
  const tabCountBefore = await tabs.count();

  await target.hover();
  await expect(editButton).toBeVisible();
  await editButton.click();

  // 編集ボタンのクリックは resume に波及しない。
  await expect(tabs).toHaveCount(tabCountBefore);

  await expect(input).toBeVisible();
  await expect(input).toHaveAttribute('aria-label', '履歴タイトルを編集');
  await expect(input).toHaveValue(originalTitle);
  await expect(input).toBeFocused();

  const renamedTitle = 'E2E-GEMINI-RENAMED-TITLE';
  await input.fill(renamedTitle);
  await input.press('Enter');
  await expect(input).toHaveCount(0);
  await expect(titleEl).toHaveText(renamedTitle);
  await expect(tabs).toHaveCount(tabCountBefore);

  // ツールバーの「更新」で gemini --list-sessions を再取得しても、
  // 保存した上書きタイトル（provider:内部UUID をキーに保存）は維持される。
  const reloadButton = window.locator('.history-list__reload');
  await reloadButton.click();
  await expect(reloadButton).toHaveText('更新');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0).locator('.history-item__title')).toHaveText(renamedTitle);
});
