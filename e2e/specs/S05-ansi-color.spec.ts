import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

test('S05 色付き出力が反映される', async () => {
  const { window } = launched;

  const screen = window.locator('.terminal-pane__container .xterm-screen').first();
  await expect(screen).toContainText(/[$%#>]/, { timeout: 20_000 });

  await window.locator('.xterm-helper-textarea').first().focus();
  // ANSI エスケープで赤色にした RED という文字列と、色を付けていない PLAIN という
  // 文字列の両方を出力し、前者だけに色付けの痕跡（DOM レンダラでは xterm-fg-* クラス）が
  // 付くことを確認する。
  await window.keyboard.type(String.raw`printf '\033[31mRED\033[0m PLAIN\n'`);
  await window.keyboard.press('Enter');

  // 注意: コマンドを打った直後（Enter 前）の入力エコー行にも "RED" という部分文字列が
  // 現れる（printf の引数文字列そのものに含まれるため、色は付いていない）。
  // screen 全体への toContainText だけでは実行結果の行が描画されたかを保証できないので、
  // 行全体のテキストが完全一致で "RED PLAIN" になる行（=出力行そのもの）が
  // 現れるまで明示的に待つ。
  const outputRow = window
    .locator('.terminal-pane__container .xterm-rows > div')
    .filter({ hasText: /^RED PLAIN$/ });
  await expect(outputRow).toHaveCount(1, { timeout: 10_000 });

  // DOM レンダラは色付き文字に xterm-fg-N クラスを付与する（インラインスタイルではなく
  // クラスでの表現）。出力行の中で RED を含む span がそれを持つことを確認する。
  const redSpan = outputRow.locator('span', { hasText: 'RED' });
  await expect(redSpan).toHaveAttribute('class', /xterm-fg-\d+/);

  // 対照として、色を付けていない PLAIN の span には fg クラスが付かないことを確認する。
  const plainSpan = outputRow.locator('span', { hasText: 'PLAIN' });
  const plainClass = await plainSpan.getAttribute('class');
  expect(plainClass ?? '').not.toMatch(/xterm-fg-\d+/);
});
