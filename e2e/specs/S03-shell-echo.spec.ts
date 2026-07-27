import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

test('S03 コマンドを入力すると出力が返る', async () => {
  const { window } = launched;

  const screen = window.locator('.terminal-pane__container .xterm-screen').first();
  // シェルのプロンプトが出るまで待ってから入力する（S02 と同じ前提）。
  await expect(screen).toContainText(/[$%#>]/, { timeout: 20_000 });

  await window.locator('.xterm-helper-textarea').first().focus();
  await window.keyboard.type('echo hello-e2e');
  await window.keyboard.press('Enter');

  // コマンド実行結果は非同期に描画されるので、自動リトライに任せる。
  await expect(screen).toContainText('hello-e2e', { timeout: 10_000 });
});
