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
 * 履歴一覧の「メモ」ボタンからセッションメモを開いて書き、
 * メモ一覧に「どのセッションのメモか」が分かる形で残ることを検証する。
 *
 * 対象行の特定は S27 と同じく並び順（nth）で行い、セッション名は固有名では
 * なく「履歴一覧に出ていた表示名と一致する」という性質で確認する。
 *
 * 「メモ」ボタンのクリックが resume（新規タブ）に波及しないことも合わせて見る。
 * ここは実際に間違えやすく、行全体の onClick に飲まれると気づきにくい。
 */
test('S30 履歴からセッションメモを開いて書ける', async () => {
  const { window } = launched;

  await window.locator('.sidebar__tabs button', { hasText: '履歴' }).click();

  const items = window.locator('.history-item');
  await expect(items).toHaveCount(3);
  const target = items.nth(2);

  const displayTitle = ((await target.locator('.history-item__title').textContent()) ?? '').trim();
  expect(displayTitle.length).toBeGreaterThan(0);

  const tabs = window.locator('.tab-bar__tab');
  const tabCountBefore = await tabs.count();

  // 操作ボタンは普段 opacity:0 で隠れており、行を hover すると見える。
  await target.hover();
  const memoButton = target.locator('button[aria-label="メモを開く"]');
  await expect(memoButton).toBeVisible();
  await memoButton.click();

  // メモを開くだけで resume は走らない
  await expect(tabs).toHaveCount(tabCountBefore);

  // サイドバーがメモタブに切り替わり、対象セッションの入力欄が開いている
  const sessionMemo = window.locator('textarea[aria-label="セッションメモ"]');
  await expect(sessionMemo).toBeVisible();
  await expect(window.locator('.memo-panel__target-title')).toHaveText(displayTitle);
  await expect(sessionMemo).toHaveValue('');

  const body = 'E2E-SESSION-MEMO';
  await sessionMemo.fill(body);
  // 「閉じる」で保存を確定してから一覧に戻る
  await window.locator('button[aria-label="セッションメモを閉じる"]').click();
  await expect(sessionMemo).toHaveCount(0);

  // メモ一覧に、履歴で見えていた表示名と本文のプレビューが並ぶ
  const memoItems = window.locator('.memo-item');
  await expect(memoItems).toHaveCount(1);
  await expect(memoItems.first().locator('.memo-item__title')).toHaveText(displayTitle);
  await expect(memoItems.first().locator('.memo-item__preview')).toHaveText(body);

  // 一覧の行をクリックすると、その本文を読み込んだ状態で編集に戻る
  await memoItems.first().click();
  await expect(window.locator('textarea[aria-label="セッションメモ"]')).toHaveValue(body);

  // タブを離れて戻っても、Main 側に保存されているので一覧に残る
  await window.locator('.sidebar__tabs button', { hasText: 'タスク' }).click();
  await window.locator('.sidebar__tabs button', { hasText: 'メモ' }).click();
  await expect(window.locator('.memo-item')).toHaveCount(1);
  await expect(window.locator('.memo-item__title')).toHaveText(displayTitle);
});
