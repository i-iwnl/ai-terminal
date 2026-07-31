import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

/** 正規表現の特殊文字をエスケープする（他 spec と同じ理由） */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Issue #56 PR 8: 閉じるときの確認（design-review.md 提案 E'）。
 *
 * **2つ以上の PTY を一度に閉じるときだけ**確認する。文言は「N 個のペインを
 * 閉じます」ではなく「走行中のプロセス N 件を終了します」（何が失われるかの語）。
 * `Cmd+Shift+W` を新設していないため、タブバーの x ボタンがマウス経由の
 * 抜け穴にならないよう、`title` / `aria-label` にペイン数を出し、同じ確認を通す。
 * 結果は role="status"（.app-status）で告知する。
 *
 * Cmd+W（closeActivePane）は常に1本しか PTY を巻き込まないため、この確認は
 * 経由しない（S56 が既に固定済み）。ここで見るのはタブ単位の閉じる操作
 * （x ボタン）だけ。
 */
test('S62 2つ以上のPTYを一度に閉じるときはタブバーのxボタンでも確認が入り、結果がrole=statusで告知される', async () => {
  const { window, workDir } = launched;
  const cwdName = workDir.split('/').pop() as string;
  const promptPattern = new RegExp(`${escapeRegExp(cwdName)}\\s*[%#]`);

  const tabs = window.locator('.tab-bar__tab');
  const panes = window.locator('.terminal-pane');
  const closeButton = tabs.first().locator('.tab-bar__close');
  const status = window.locator('.app-status');

  await expect(tabs).toHaveCount(1);
  await expect(panes).toHaveCount(1);
  await expect(window.locator('.terminal-pane.is-active .xterm-screen')).toContainText(promptPattern, {
    timeout: 20_000,
  });

  // 1ペインのうちは確認無しで閉じられる（1本しか失われないため）。
  // ラベルにペイン数が出ないことも確認する。
  await expect(closeButton).toHaveAttribute('aria-label', 'タブを閉じる');
  await expect(closeButton).toHaveAttribute('title', 'タブを閉じる');

  // --- 2ペインにする -----------------------------------------------------
  await window.keyboard.press('Meta+d');
  await expect(panes).toHaveCount(2);

  // x ボタンのラベルにペイン数が出る（押す前に「何本失われるか」が分かる）。
  await expect(closeButton).toHaveAttribute('aria-label', 'タブを閉じる（2 ペイン）');
  await expect(closeButton).toHaveAttribute('title', 'タブを閉じる（2 ペイン）');

  // --- x ボタンを押すと確認ダイアログが出て、まだ閉じない -------------------
  await closeButton.click();

  const dialog = window.locator('[role="alertdialog"]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('走行中のプロセス 2 件を終了します');
  // まだ閉じていない。
  await expect(tabs).toHaveCount(1);
  await expect(panes).toHaveCount(2);

  // 既定フォーカスは「キャンセル」（破壊的操作を安全側に倒す）。
  await expect(window.locator('button', { hasText: 'キャンセル' })).toBeFocused();

  // --- Escape でキャンセル: 何も変わらない -----------------------------------
  await window.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(tabs).toHaveCount(1);
  await expect(panes).toHaveCount(2);

  // --- 再度開いて、今度は「終了する」で確定する -------------------------------
  await closeButton.click();
  await expect(dialog).toBeVisible();
  await window.locator('button', { hasText: '終了する' }).click();
  await expect(dialog).toHaveCount(0);

  // タブが0枚になった代わりに、新しいシェルタブが自動で開く（S08 と同じ挙動）。
  await expect(tabs).toHaveCount(1, { timeout: 10_000 });
  await expect(panes).toHaveCount(1);

  // 結果が role="status" で告知されること（視覚以外で「タブを閉じた」と
  // 分かる唯一の手段。design-review.md 提案 E'）。
  await expect(status).toHaveText('タブを閉じました', { timeout: 10_000 });
});
