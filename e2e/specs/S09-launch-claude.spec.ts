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
 * 偽 claude は対話起動時に受け取った引数をそのまま `ARGS: ...` として出力する。
 * これを使って、アプリが --session-id に UUID 形式の値を渡していることを
 * ターミナルの表示から検証する（内部実装を直接覗かずに済む）。
 */
test('S09 claude を起動すると session-id が渡る', async () => {
  const { window } = launched;

  // 起動直後は React のマウントとグローバルショートカットの登録に一瞬かかる。
  // 最初のシェルタブのプロンプトが出るまで待ってから操作することで、
  // ショートカットの取りこぼし（早すぎる Meta+k）を避ける。
  const initialScreen = window.locator('.terminal-pane__container .xterm-screen').first();
  await expect(initialScreen).toContainText(/[$%#>]/, { timeout: 20_000 });

  await window.keyboard.press('Meta+k');

  // claude タブが開き、アクティブになること
  await expect(window.locator('.tab-bar__title').filter({ hasText: 'claude' })).toBeVisible();

  // アクティブなタブ（非表示でない terminal-pane）の実際に描画された行に ARGS 行が出ること。
  // xterm.js の DOM レンダラは .xterm-screen の子に <style> タグ（カーソル点滅の
  // keyframes 等）を注入するため、.xterm-screen の textContent はその CSS テキストまで
  // 拾ってしまい判定が不安定になる。.xterm-rows（実際に描画された行だけを持つ要素）を
  // 直接見ることでこれを避ける。
  const activeRows = window
    .locator('.terminal-pane:not(.terminal-pane--hidden) .xterm-rows')
    .first();
  await expect(activeRows).toContainText('FAKE CLAUDE READY', { timeout: 20_000 });
  await expect(activeRows).toContainText(/ARGS:.*--session-id/);

  // --session-id の値が UUID 形式であることまで確認する。
  // .xterm-rows は行ごとに <div> が分かれており、textContent は改行を挿入せず
  // 連結されるため、行分割ではなく ARGS: ... --session-id <uuid> を
  // ひと続きの正規表現で直接取り出す。
  const rowsText = (await activeRows.textContent()) ?? '';
  const match = rowsText.match(
    /ARGS:.*?--session-id\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  expect(match, `ARGS 行から --session-id の UUID を抽出できなかった: ${rowsText}`).not.toBeNull();
});
