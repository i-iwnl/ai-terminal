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
 * メニュー経由の操作を Renderer へ送る（`S85-pane-rename.spec.ts` と同じ形。
 * ハーネスには無いので spec ごとに置く）。
 */
async function sendMenuAction(app: LaunchedApp['app'], type: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, actionType) => {
    const win = BrowserWindow.getAllWindows()[0];
    win?.webContents.send('menu:action', { type: actionType });
  }, type);
}

/** xterm が付ける既定の名前。**英語で、しかも全ペイン共通**。 */
const XTERM_DEFAULT_LABEL = 'Terminal input';

/**
 * Issue #150: xterm の入力用 textarea（`.xterm-helper-textarea`）に、
 * どのペインの端末かが分かる名前を付ける。
 *
 * **直す前は全ペインが `Terminal input`** だった（実測。分割すると支援技術の
 * ローターに同じ名前が2つ並び、**どちらの端末か区別できない**）。
 *
 * ⛔ **`Terminal.strings.promptLabel` では解けない。** あれは **static** なので
 * インスタンスごとに別の値を持てず、リネームにも cwd の追従にも乗らない。
 * textarea へ直接 `aria-label` を張る形にしてある。
 *
 * ⚠ **「名前が付いた」だけを見ても足りない。** 全ペインに同じ日本語名を付ける
 * 実装でも通ってしまう。**2枚が別の名前になること**まで見る。
 */
test('S101 分割しても、入力欄の名前でどちらの端末か区別できる', async () => {
  const { window } = launched;
  await expect(window.locator('.xterm-screen').first()).toBeVisible({ timeout: 15_000 });

  const textareas = window.locator('textarea.xterm-helper-textarea');
  const labelOf = (index: number): Promise<string | null> =>
    textareas.nth(index).getAttribute('aria-label');

  // --- 1枚のとき: 既定の英語名ではなく、ペインの名前を名乗る ---
  await expect(textareas).toHaveCount(1);
  const single = await labelOf(0);
  expect(single).not.toBe(XTERM_DEFAULT_LABEL);
  expect(single).toMatch(/^ターミナル、/);
  // ⛔ 区切りにコロンを使わない（VoiceOver が「コロン」を発話しうる）。
  expect(single).not.toContain(':');
  expect(single).not.toContain('：');

  // ペイン自身の名前（`role="group"` / `"tabpanel"` の名前）を含んでいること。
  // **同じ1つのペインに名前が2通りできていない**ことの確認。
  const paneLabel = await window
    .locator('.terminal-pane')
    .first()
    .getAttribute('aria-label')
    .then((v) => v ?? '');
  expect(paneLabel.length).toBeGreaterThan(0);
  expect(single).toContain(paneLabel);

  // --- 分割する ---
  await window.keyboard.press('Meta+d');
  await expect(textareas).toHaveCount(2);

  // 分割直後は2枚とも同じ種別・同じ cwd なので、**名前も同じで正しい**
  // （区別は利用者がペインに名前を付けて作る。Issue #130 で入れた経路）。
  // ここで見るのは「英語の既定名に戻っていないこと」。
  for (const index of [0, 1]) {
    expect(await labelOf(index)).not.toBe(XTERM_DEFAULT_LABEL);
  }

  // --- アクティブなペインに名前を付けると、入力欄の名前も追従する ---
  await sendMenuAction(launched.app, 'rename-active-pane');
  const titleInput = window.locator('input[aria-label="ペイン名を編集"]');
  await expect(titleInput).toBeVisible();
  const renamed = 'E2E-NAMED-PANE';
  await titleInput.fill(renamed);
  await titleInput.press('Enter');
  await expect(titleInput).toHaveCount(0);

  // ⭐ **2枚の名前が別々になる**（この spec の本体）。
  await expect
    .poll(async () => (await labelOf(0)) !== (await labelOf(1)), { timeout: 10_000 })
    .toBe(true);

  // 名前を付けたほうに、その名前が入っていること。
  const labels = [await labelOf(0), await labelOf(1)];
  expect(labels.filter((l) => l?.includes(renamed))).toHaveLength(1);
});
