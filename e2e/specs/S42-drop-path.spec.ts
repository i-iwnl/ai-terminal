import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

test('S42 ファイルをターミナルにドロップすると、エスケープされたパスが挿入される', async () => {
  const { window } = launched;

  const screen = window.locator('.terminal-pane__container .xterm-screen').first();
  // シェルのプロンプトが出てから落とす（S02 / S03 と同じ前提）。
  await expect(screen).toContainText(/[$%#>]/, { timeout: 20_000 });

  // Finder からの本物のドラッグは files と uri-list の両方を持つが、
  // files 側の絶対パスは webUtils.getPathForFile() でしか引けず、合成 File には効かない。
  // uri-list 経路だけが E2E から再現できる（scenarios.yml の note 参照）。
  await window.locator('.terminal-pane').first().evaluate((el) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/uri-list', 'file:///tmp/a%20b.txt\r\nfile:///tmp/c.txt\r\n');
    el.dispatchEvent(
      new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true }),
    );
  });

  // 空白を含む方だけがエスケープされ、2件がスペース区切りで並ぶこと。
  // シェルがエコーバックした行として画面に出る。
  await expect(screen).toContainText('/tmp/a\\ b.txt /tmp/c.txt', { timeout: 10_000 });
});
