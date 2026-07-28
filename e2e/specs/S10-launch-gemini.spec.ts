import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

test('S10 gemini を起動できる', async () => {
  const { window } = launched;

  // 起動直後は React のマウントとグローバルショートカットの登録に一瞬かかる。
  // 最初のシェルタブのプロンプトが出るまで待ってから操作する（S09 と同様）。
  const initialScreen = window.locator('.terminal-pane__container .xterm-screen').first();
  await expect(initialScreen).toContainText(/[$%#>]/, { timeout: 20_000 });

  await window.keyboard.press('Meta+Shift+K');

  // gemini タブが開き、アクティブになること
  await expect(window.locator('.tab-bar__title').filter({ hasText: 'gemini' })).toBeVisible();

  // .xterm-screen は xterm.js の DOM レンダラが注入する <style>（カーソル点滅の
  // keyframes 等）まで textContent に含んでしまうため、実際に描画された行だけを
  // 持つ .xterm-rows を直接見る（S09 と同様の理由）。
  const activeRows = window
    .locator('.terminal-pane:not(.terminal-pane--hidden) .xterm-rows')
    .first();
  await expect(activeRows).toContainText('FAKE GEMINI READY', { timeout: 20_000 });
});
