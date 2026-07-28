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
 * 日本語 IME の変換中表示。
 *
 * Playwright の通常のキー入力では IME の変換過程を再現できないが、
 * Chromium の DevTools Protocol には Input.imeSetComposition があり、
 * 変換中（未確定）の状態を作れる。Electron は Chromium なのでこれが使える。
 *
 * ただしこれで担保できるのは xterm.js 側の composition 処理までで、
 * macOS の入力メソッド（ことえり等）との実際の相互作用は再現していない。
 * OS レベルの確認は手動チェックリストに残す。
 */
test('S22 IME の変換中テキストが表示され、確定するとシェルに渡る', async () => {
  const { window, app } = launched;

  const screen = window.locator('.terminal-pane__container .xterm-screen').first();
  await expect(screen).toContainText(/[$%#>]/, { timeout: 20_000 });

  await window.locator('.xterm-helper-textarea').first().focus();

  const cdp = await app.context().newCDPSession(window);

  // 変換中（未確定）の状態を作る
  await cdp.send('Input.imeSetComposition', {
    text: 'にほんご',
    selectionStart: 4,
    selectionEnd: 4,
  });

  // xterm は変換中の文字列を .composition-view に表示する
  // （クラス名に xterm- の接頭辞が付かない点に注意）
  const composition = window.locator('.composition-view').first();
  await expect(composition).toHaveClass(/active/);
  await expect(composition).toContainText('にほんご');

  // 確定する
  await cdp.send('Input.insertText', { text: '日本語' });

  // 確定した文字列がシェルへ渡り、画面に描画されること
  await expect(screen).toContainText('日本語', { timeout: 10_000 });
});
