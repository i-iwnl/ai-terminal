import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

test('S25 マウスでテキストを選択してコピーできる', async () => {
  const { app, window } = launched;

  const screen = window.locator('.terminal-pane__container .xterm-screen').first();
  await expect(screen).toContainText(/[$%#>]/, { timeout: 20_000 });

  // 前の実行で残ったクリップボードの内容で誤って緑にならないよう、番兵を置く。
  await app.evaluate(({ clipboard }) => clipboard.writeText('S25-CLIPBOARD-SENTINEL'));

  await window.locator('.xterm-helper-textarea').first().focus();
  await window.keyboard.type('echo S25-SELECT-ME', { delay: 20 });
  await window.keyboard.press('Enter');

  // 出力行が描画されるまで待つ。
  await expect(screen).toContainText('S25-SELECT-ME', { timeout: 15_000 });

  // 出力行の矩形を取り、その上をドラッグして選択する。
  // DOM レンダラでは行が div になるので、文字列を含む行を直接掴める。
  const row = window
    .locator('.terminal-pane__container .xterm-rows > div')
    .filter({ hasText: 'S25-SELECT-ME' })
    .last();
  const box = await row.boundingBox();
  expect(box, '選択対象の行の矩形を取得できない').not.toBeNull();
  if (!box) return;

  const y = box.y + box.height / 2;
  await window.mouse.move(box.x + 2, y);
  await window.mouse.down();
  await window.mouse.move(box.x + box.width - 2, y, { steps: 15 });
  await window.mouse.up();

  await window.keyboard.press('Meta+c');

  // クリップボードに選択した文字列が入る = 選択もコピーも効いている。
  await expect
    .poll(async () => app.evaluate(({ clipboard }) => clipboard.readText()), {
      message: 'ドラッグで選択した文字列がクリップボードに入っていない',
      timeout: 10_000,
    })
    .toContain('S25-SELECT-ME');
});
