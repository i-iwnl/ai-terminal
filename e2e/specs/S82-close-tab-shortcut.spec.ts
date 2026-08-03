import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

/**
 * Issue #120 の周1。分割中のタブを1手で閉じる（`Cmd+Option+W`）。
 *
 * `Cmd+W` は `close-pane` で、**残るペインが1枚ならタブごと閉じる**ので、
 * 分割していないタブでは macOS 標準どおりに振る舞う。だが**分割中のタブを
 * 閉じるにはペインの枚数ぶん押す必要があった**（他ターミナルの筋肉記憶では
 * `Cmd+W` 一発でタブが消えるので「閉じたつもりが半分残る」）。
 * メニューの「タブを閉じる」はキーを持っていなかった。
 *
 * `Cmd+Shift+W` は macOS 全域で「ウィンドウを閉じる」と学習されているので使わない。
 *
 * **判定は `e.code`。** macOS では Option を押しながらの英字キーは合成後の文字が
 * `e.key` に入りうる（Option+w -> `∑`）。`Cmd+Option+S` と同じ理由。
 */

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

test('S82 Cmd+Option+W は分割中のタブも1手で閉じる', async () => {
  const { window } = launched;

  await expect(window.locator('.terminal-pane__container .xterm-screen').first()).toContainText(
    /[$%#>]/,
    { timeout: 20_000 },
  );

  // 2枚目のタブを開き、そこを分割する（1枚目は残しておかないと、
  // 最後の1枚を閉じたときの自動再生成と区別が付かない）。
  await window.keyboard.press('Meta+t');
  const tabs = window.locator('.tab-bar__tab');
  await expect(tabs).toHaveCount(2, { timeout: 15_000 });

  await window.keyboard.press('Meta+d');
  await expect(window.locator('.pane-split__cell')).toHaveCount(2, { timeout: 15_000 });

  // --- Cmd+Option+W で、分割していてもタブごと閉じる --------------------------
  await window.keyboard.press('Meta+Alt+w');

  // 2本の PTY を一度に閉じるので確認ダイアログが出る（既存の仕様）。
  const confirm = window.locator('.confirm-dialog');
  await expect(confirm).toBeVisible({ timeout: 15_000 });
  await confirm.locator('.confirm-dialog__button--danger').click();

  // **1手でタブが消える**（ペインの枚数ぶん押す必要が無い）。
  await expect(tabs).toHaveCount(1, { timeout: 15_000 });
});
