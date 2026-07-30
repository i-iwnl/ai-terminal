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
 * Issue #20 PR 9: 履歴一覧の行が `<li onClick>` のままで resume していた。
 * TaskList.tsx（#64 / PR #80）の流儀に合わせ、`<li>` は保ったまま resume する
 * 部分だけを内側の `<button>` にする。
 *
 * ただしこの行には resume 用ボタンの他に「メモ」「編集」という**別の**
 * インタラクティブ要素がある。<button> の中に <button> を入れ子にはできない
 * （HTML の内容モデル上、<button> はインタラクティブコンテンツの子孫を許さない）
 * ため、resume 用ボタンとメモ/編集ボタンは兄弟にする必要がある。
 * この分割が正しく効いていれば、次がすべてキーボードだけで成立するはず:
 *
 * 1. resume 用ボタンに Tab で到達できる
 * 2. その直後（同じ行の中）に「メモ」「編集」にも独立して Tab で到達できる
 *    （resume ボタンに飲まれて消えていない = 入れ子にしていない証拠）
 * 3. resume 用ボタンへ Enter を送ると実際に resume が走る
 */
test('S52 キーボードだけで履歴一覧の resume・メモ・編集ボタンに到達できる', async () => {
  const { window } = launched;

  await window.locator('.sidebar__tabs button', { hasText: '履歴' }).click();

  const items = window.locator('.history-item');
  await expect(items).toHaveCount(3);

  // harness.ts の3件は mtime 降順で「壊れたもの」「タイトル無し」「正常」の順
  // （S16 参照）。正常なエントリ（末尾）を対象にする。
  const target = items.nth(2);
  const resumeButton = target.locator('.history-item__row');
  const memoButton = target.locator('button[aria-label="メモを開く"]');
  const editButton = target.locator('button[aria-label="タイトルを編集"]');

  await expect(resumeButton).toHaveCount(1);
  expect(await resumeButton.evaluate((el) => el.tagName)).toBe('BUTTON');

  const tabsBefore = window.locator('.tab-bar__tab');
  const tabCountBefore = await tabsBefore.count();

  // 「更新」ボタンを起点にする（一覧の直前にある、クリックで確実に押せる
  // ボタン。ここから先はキーボードだけで進む。S47 と同じ考え方）。
  await window.locator('.history-list__reload').focus();

  const isFocused = async (loc: typeof resumeButton): Promise<boolean> =>
    loc.evaluate((el) => el === document.activeElement).catch(() => false);

  // --- 1. resume 用ボタンへ Tab だけで到達する -----------------------------
  let reachedResume = false;
  for (let i = 0; i < 30 && !reachedResume; i++) {
    await window.keyboard.press('Tab');
    reachedResume = await isFocused(resumeButton);
  }
  expect(reachedResume, 'Tab だけで対象行の resume ボタンに到達できること').toBe(true);

  // --- 2. 続けて Tab を押すと、同じ行の「メモ」「編集」に独立して到達する ---
  // （resume ボタンに入れ子にしていれば、ここに到達する前に飲み込まれて消える
  // か、そもそも操作不能な壊れたマークアップになる）。
  await window.keyboard.press('Tab');
  expect(await isFocused(memoButton), '次の Tab で「メモ」ボタンに到達する').toBe(true);

  await window.keyboard.press('Tab');
  expect(await isFocused(editButton), 'さらに次の Tab で「編集」ボタンに到達する').toBe(true);

  // --- 3. resume ボタンへ戻り、Enter で実際に resume する -------------------
  await window.keyboard.press('Shift+Tab');
  await window.keyboard.press('Shift+Tab');
  expect(await isFocused(resumeButton), 'Shift+Tab で resume ボタンへ戻る').toBe(true);

  await window.keyboard.press('Enter');

  await expect(tabsBefore).toHaveCount(tabCountBefore + 1, { timeout: 15_000 });
  const screen = window.locator('.terminal-pane__container .xterm-screen').last();
  await expect(screen).toContainText('FAKE CLAUDE READY', { timeout: 20_000 });
  await expect(screen).toContainText(/ARGS:.*--resume/, { timeout: 20_000 });
});
