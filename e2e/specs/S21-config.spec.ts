import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp | undefined;

test.afterEach(async () => {
  if (launched) await closeApp(launched);
  launched = undefined;
});

/**
 * config.json のフォントサイズとテーマ色が xterm の描画に反映されることを検証する。
 * 「既定値と違う値が入っている」ことまで確認しないと、config を読み込んでいなくても
 * テストが通ってしまう（既定値の fontSize は 13、背景色は #1e1e1e）ので、
 * 明示的に既定値との差分を見る。
 */
test('S21 設定のフォントサイズとテーマが反映される', async () => {
  launched = await launchApp({
    config: {
      fontSize: 20,
      theme: {
        background: '#123456',
        foreground: '#abcdef',
        cursor: '#abcdef',
        selectionBackground: '#264f78',
      },
    },
  });
  const { window } = launched;

  const screen = window.locator('.terminal-pane__container .xterm-screen').first();
  await expect(screen).toBeVisible();
  // シェルが実際に起動し、xterm が config を読み込んで再描画し終えるまで待つ
  await expect(screen).toContainText(/[$%#>]/, { timeout: 20_000 });

  // 背景色: xterm の DOM レンダラは .xterm-scrollable-element に
  // 背景色をインラインスタイルで設定する
  const scrollable = window.locator('.terminal-pane__container .xterm-scrollable-element').first();
  await expect(async () => {
    const bg = await scrollable.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).toBe('rgb(18, 52, 86)'); // #123456
  }).toPass({ timeout: 20_000 });

  // フォントサイズ: 行コンテナ（.xterm-rows）に font-size が反映される
  const rows = window.locator('.terminal-pane__container .xterm-rows').first();
  const fontSize = await rows.evaluate((el) => getComputedStyle(el).fontSize);
  expect(fontSize).toBe('20px');
  expect(fontSize).not.toBe('13px');
});
