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
 * 履歴一覧のタイトルインライン編集（claude 側）を検証する。
 *
 * harness.ts が配置する3件の履歴は mtime 降順で
 * 「壊れたもの（33333333）」「タイトル無し（22222222）」「正常（11111111）」の順に
 * 並ぶ（S16 参照）。この並び順はタイトル変更では変わらないため、対象行の特定は
 * 本文一致ではなく並び順（nth）で行い、タイトル文字列は「編集前後で変わったか」
 * という性質で検証する（自分で設定した新タイトルの文字列だけは固有名一致でよい）。
 */
test('S27 履歴のタイトルをインライン編集できる', async () => {
  const { window } = launched;

  await window.locator('.sidebar__tabs button', { hasText: '履歴' }).click();

  const items = window.locator('.history-item');
  await expect(items).toHaveCount(3);
  const normal = items.nth(2);

  const titleEl = normal.locator('.history-item__title');
  const editButton = normal.locator('button.history-item__edit');
  const input = normal.locator('input.history-item__title-input');

  const originalTitle = ((await titleEl.textContent()) ?? '').trim();
  expect(originalTitle.length).toBeGreaterThan(0);

  const tabs = window.locator('.tab-bar__tab');
  const tabCountBefore = await tabs.count();

  // 編集ボタンは普段 opacity:0 で隠れており、行を hover すると見える。
  await normal.hover();
  await expect(editButton).toBeVisible();
  await editButton.click();

  // 編集ボタンのクリックは resume（新規タブオープン）に波及しない。
  await expect(tabs).toHaveCount(tabCountBefore);

  // タイトル部分が input に切り替わる。初期値は表示中のタイトルで、
  // フォーカス済み・全選択されている。
  await expect(input).toBeVisible();
  await expect(editButton).toHaveCount(0);
  await expect(input).toHaveAttribute('aria-label', '履歴タイトルを編集');
  await expect(input).toHaveValue(originalTitle);
  await expect(input).toBeFocused();
  const selection = await input.evaluate((el) => {
    const inputEl = el as HTMLInputElement;
    return { start: inputEl.selectionStart, end: inputEl.selectionEnd, length: inputEl.value.length };
  });
  expect(selection.start).toBe(0);
  expect(selection.end).toBe(selection.length);

  // 新しいタイトルを入力して Enter で確定すると、一覧の表示が新タイトルに変わる。
  const renamedTitle = 'E2E-RENAMED-HISTORY-TITLE';
  await input.fill(renamedTitle);
  await input.press('Enter');
  await expect(input).toHaveCount(0);
  await expect(titleEl).toHaveText(renamedTitle);
  await expect(tabs).toHaveCount(tabCountBefore);

  // ツールバーの「更新」で再取得しても、Main に保存した上書きタイトルは維持される。
  const reloadButton = window.locator('.history-list__reload');
  await reloadButton.click();
  await expect(reloadButton).toHaveText('更新');
  await expect(items).toHaveCount(3);
  await expect(items.nth(2).locator('.history-item__title')).toHaveText(renamedTitle);

  const normalAfterReload = items.nth(2);
  const inputAfterReload = normalAfterReload.locator('input.history-item__title-input');

  // Escape でキャンセルすると、入力中の下書きは捨てられ直前に確定した
  // タイトルのまま表示に戻る（＝ renamedTitle から変化しない）。
  await normalAfterReload.hover();
  await normalAfterReload.locator('button.history-item__edit').click();
  await expect(inputAfterReload).toBeVisible();
  await inputAfterReload.fill('DISCARDED-BY-ESCAPE');
  await inputAfterReload.press('Escape');
  await expect(inputAfterReload).toHaveCount(0);
  await expect(normalAfterReload.locator('.history-item__title')).toHaveText(renamedTitle);
  await expect(tabs).toHaveCount(tabCountBefore);

  // 編集中の行をクリックしても resume は発火しない
  // （input の外、同じ行内の要素＝メタ情報部分をクリックして blur させるケース）。
  await normalAfterReload.locator('button.history-item__edit').click();
  await expect(inputAfterReload).toBeVisible();
  await normalAfterReload.locator('.history-item__meta').click();
  await expect(inputAfterReload).toHaveCount(0);
  await expect(tabs).toHaveCount(tabCountBefore);
  await expect(normalAfterReload.locator('.history-item__title')).toHaveText(renamedTitle);
});
