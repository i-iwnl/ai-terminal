import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

/**
 * 自動保存の待ち時間（800ms）より早くアプリを終了しても、書いたメモが失われないことを検証する。
 *
 * S29 はサイドバーのタブ切り替え（= textarea の blur）を経由するので、
 * 保留中のタイマーではなく blur 時の即時保存が効いている。**終了経路は通っていない。**
 *
 * ここでは blur を起こさずに入力し、デバウンスが焼ける前にウィンドウを閉じて、
 * 一時 HOME の memos.json をファイルとして直接読む。アプリを開き直して確認する形にすると
 * 「保存されたか」ではなく「再起動後に読めるか」を見ることになり、保存の取りこぼしを
 * 別の経路で埋め合わせても緑になってしまう。
 */
test('S33 自動保存が焼ける前に終了してもメモが失われない', async () => {
  const { window, app, home } = launched;

  const memoTab = window.locator('.sidebar__tabs button', { hasText: 'メモ' });
  await memoTab.click();

  const globalMemo = window.locator('textarea[aria-label="全体メモ"]');
  await expect(globalMemo).toBeVisible();
  await expect(globalMemo).toHaveValue('');

  const body = 'E2E-QUIT-FLUSH';
  // fill() ではなく実際のキー入力にする。fill() は React の onChange を1回で
  // 済ませるが、いずれにせよデバウンスの起点は同じ。フォーカスを外さないことが要点。
  await globalMemo.click();
  await globalMemo.type(body);
  await expect(globalMemo).toHaveValue(body);

  // 800ms 待たずに閉じる。待ってしまうと保留中のタイマーが焼けて、
  // 終了時のフラッシュが無くても緑になる。
  await app.close();

  const saved = readFileSync(join(home, '.ai-terminal', 'memos.json'), 'utf8');
  expect(JSON.parse(saved)).toMatchObject({ global: { body } });
});
