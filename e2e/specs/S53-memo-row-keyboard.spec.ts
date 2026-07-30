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
 * Issue #20 PR 9: メモ一覧（セッションメモ）の行が `<li onClick>` のままで、
 * キーボードでは開けなかった。TaskList.tsx（#64 / PR #80）と同じ流儀で
 * `<li>` は保ったまま中身を <button> にする。履歴一覧の行と違い、
 * メモの行には他のインタラクティブ要素（メモ / 編集 相当のボタン）が
 * 無いため、行全体を1つの <button> にできる（div/button の分岐は無い）。
 *
 * 検証は「Tab だけで一覧の行に到達し、Enter でそのメモが開くこと」。
 * メモ自体は履歴一覧の「メモ」ボタン経由で作る（S30 と同じ手順）。
 */
test('S53 キーボードだけでメモ一覧の行に到達し、Enter でメモが開く', async () => {
  const { window } = launched;

  // まず履歴からセッションメモを1件作る（S30 と同じ手順）。
  await window.locator('.sidebar__tabs button', { hasText: '履歴' }).click();
  const items = window.locator('.history-item');
  await expect(items).toHaveCount(3);
  const target = items.nth(2);

  const displayTitle = ((await target.locator('.history-item__title').textContent()) ?? '').trim();
  expect(displayTitle.length).toBeGreaterThan(0);

  await target.hover();
  const memoButton = target.locator('button[aria-label="メモを開く"]');
  await expect(memoButton).toBeVisible();
  await memoButton.click();

  const sessionMemo = window.locator('textarea[aria-label="セッションメモ"]');
  await expect(sessionMemo).toBeVisible();
  const body = 'E2E-S53-MEMO-BODY';
  await sessionMemo.fill(body);
  await window.locator('button[aria-label="セッションメモを閉じる"]').click();
  await expect(sessionMemo).toHaveCount(0);

  // メモ一覧に切り替える。
  await window.locator('.sidebar__tabs button', { hasText: 'メモ' }).click();
  const memoItems = window.locator('.memo-item');
  await expect(memoItems).toHaveCount(1);

  const memoRow = memoItems.first().locator('.memo-item__row');
  await expect(memoRow).toHaveCount(1);
  expect(await memoRow.evaluate((el) => el.tagName)).toBe('BUTTON');

  // 「全体メモ」の入力欄を起点にする（メモタブの中に既にある、確実に押せる
  // フォーカス対象。ここから先はキーボードだけで進む。S47 / S52 と同じ考え方）。
  await window.locator('textarea[aria-label="全体メモ"]').focus();

  let reached = false;
  for (let i = 0; i < 15 && !reached; i++) {
    await window.keyboard.press('Tab');
    reached = await memoRow.evaluate((el) => el === document.activeElement).catch(() => false);
  }
  expect(reached, 'Tab だけでメモ一覧の行に到達できること').toBe(true);

  await window.keyboard.press('Enter');

  await expect(window.locator('textarea[aria-label="セッションメモ"]')).toHaveValue(body);
  await expect(window.locator('.memo-panel__target-title')).toHaveText(displayTitle);
});
