import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

test('S24 全画面 TUI が描画され、終了するとプロンプトに戻る', async () => {
  const { window } = launched;

  const screen = window.locator('.terminal-pane__container .xterm-screen').first();
  await expect(screen).toContainText(/[$%#>]/, { timeout: 20_000 });

  const textarea = window.locator('.xterm-helper-textarea').first();
  await textarea.focus();

  // vim を代替画面で開く。ここで確かめたいのは vim そのものではなく、
  // 全画面を書き換える TUI が崩れずに描画されること。
  await window.keyboard.type('vim', { delay: 20 });
  await window.keyboard.press('Enter');

  // 空バッファの行頭に並ぶ ~ が vim の画面が描けている証拠。
  await expect(screen).toContainText('~', { timeout: 20_000 });

  // 入力した文字が反映されること（代替画面上での再描画）。
  await window.keyboard.type('iS24-INSIDE-VIM', { delay: 20 });
  await expect(screen).toContainText('S24-INSIDE-VIM', { timeout: 10_000 });
  await expect(screen).toContainText('INSERT', { timeout: 10_000 });

  // 保存せずに抜ける。代替画面から通常画面へ戻れること。
  await window.keyboard.press('Escape');
  await window.keyboard.type(':q!', { delay: 30 });
  await window.keyboard.press('Enter');

  // vim の画面が消えてプロンプトに戻る。
  // ~ が残っていると代替画面から復帰できていない。
  await expect(screen).not.toContainText('S24-INSIDE-VIM', { timeout: 20_000 });
  await expect(screen).toContainText(/[$%#>]/, { timeout: 10_000 });

  // 抜けた後にコマンドを実行できること（シェルが生きている）。
  await window.keyboard.type('echo S24-BACK-IN-SHELL', { delay: 20 });
  await window.keyboard.press('Enter');
  await expect(screen).toContainText('S24-BACK-IN-SHELL', { timeout: 10_000 });
});
