import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

/** 正規表現の特殊文字をエスケープする（workDir のディレクトリ名をそのままパターン化するため） */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * タブ切り替え時に Terminal インスタンスが破棄されないことの担保。
 *
 * useTerminal.ts のコメントにある通り、非表示のタブは DOM から外さず
 * `visibility: hidden` で隠すだけ（scrollback を失わないため）。
 * そのためタブ1・タブ2の `.terminal-pane__container` は両方とも常に DOM に
 * 存在し続ける。生成順に描画されるので、1枚目のタブは `.nth(0)`、
 * 2枚目のタブは `.nth(1)` として一貫して参照できる。
 *
 * ここではタブ1に目印を出力 -> タブ2を開いて別の目印を出力 -> タブ1に戻って
 * 目印がまだ残っていること（かつタブ2の内容と混ざっていないこと）を確認する。
 */
test('S07 タブを切り替えても各タブの内容が保持される', async () => {
  const { window, workDir } = launched;

  // タブ2（テスト中に動的に開く方のタブ）はシェル起動直後の "Restored session: ..." 等の
  // 前置きメッセージを含む行に緩い正規表現 /[$%#>]/ が早期マッチし、シェルがまだ入力を
  // 受け付けない状態でタイプしてしまうことがある（実機で再現した不具合、S08 も参照）。
  // カレントディレクトリ名を含む本物のプロンプト行にだけマッチする正規表現で待つ。
  const cwdName = workDir.split('/').pop() as string;
  const promptPattern = new RegExp(`${escapeRegExp(cwdName)}\\s*[%#]`);

  const screens = window.locator('.terminal-pane__container .xterm-screen');
  const helperTextareas = window.locator('.xterm-helper-textarea');
  // 直接の子孫（>）ではなく子孫セレクタにする。role="tablist" 化（Issue #20 PR 9）で
  // タブは .tab-bar__tabs > .tab-bar__tablist > .tab-bar__tab の3階層になったため。
  const tabs = window.locator('.tab-bar__tab');

  // --- タブ1: 目印を出力する ---
  await expect(tabs).toHaveCount(1);
  const tabOneScreen = screens.nth(0);
  await expect(tabOneScreen).toContainText(/[$%#>]/, { timeout: 20_000 });

  await helperTextareas.nth(0).focus();
  await window.keyboard.type('echo TAB-ONE-MARKER');
  await window.keyboard.press('Enter');
  await expect(tabOneScreen).toContainText('TAB-ONE-MARKER', { timeout: 10_000 });

  // --- タブ2を新規に開き、別の目印を出力する ---
  await window.keyboard.press('Meta+t');
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(1)).toHaveClass(/is-active/);

  const tabTwoScreen = screens.nth(1);
  await expect(tabTwoScreen).toContainText(promptPattern, { timeout: 20_000 });

  await helperTextareas.nth(1).focus();
  await window.keyboard.type('echo TAB-TWO-MARKER');
  await window.keyboard.press('Enter');
  await expect(tabTwoScreen).toContainText('TAB-TWO-MARKER', { timeout: 10_000 });

  // --- タブ1に戻る（Cmd+1） ---
  await window.keyboard.press('Meta+1');
  await expect(tabs.nth(0)).toHaveClass(/is-active/);

  // タブ1の内容（目印）が消えずに残っていること。
  await expect(tabOneScreen).toContainText('TAB-ONE-MARKER');
  // タブ1の画面にタブ2の目印が混入していないこと（別インスタンスであることの確認）。
  await expect(tabOneScreen).not.toContainText('TAB-TWO-MARKER');

  // タブ2側も、非表示になっただけで内容が保持され続けていること。
  await expect(tabTwoScreen).toContainText('TAB-TWO-MARKER');
});
