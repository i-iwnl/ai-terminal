import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  // ショートカットの取りこぼし（早すぎる Meta+Shift+C）を避ける。
  const initialScreen = window.locator('.terminal-pane__container .xterm-screen').first();
  await expect(initialScreen).toContainText(/[$%#>]/, { timeout: 20_000 });

  await window.keyboard.press('Meta+Shift+C');

  // claude タブが開き、アクティブになること。
  // Issue #20 PR 10 でタブタイトルの既定が basename(cwd) になったため、
  // 'claude' 固定ではなく起動ディレクトリ（ハーネスの workDir）の
  // basename である 'demo-project' が出る（e2e/fixtures/harness.ts 参照）。
  await expect(window.locator('.tab-bar__title').filter({ hasText: 'demo-project' })).toBeVisible();

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
  //
  // **画面ではなくファイルから読む**（Issue #121 B-2）。偽 claude は
  // 採番された UUID を画面に出さず（撮影のたびに docs/images/ が変わるため）、
  // `claude-session-id.txt` へ書き出す。画面をパースするより堅い。
  const sessionId = readFileSync(join(launched.fixturesDir, 'claude-session-id.txt'), 'utf8').trim();
  expect(
    sessionId,
    `偽 claude が受け取った --session-id が UUID 形式ではない: ${sessionId}`,
  ).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

  // **画面に生の UUID が出ていないこと**（撮影レーンの決定性の関門）。
  // ここが崩れると docs/images/ が撮るたびに変わり、
  // 「画像の中身が実装とずれたか」を画素で検出できなくなる。
  const rowsText = (await activeRows.textContent()) ?? '';
  expect(
    rowsText,
    'ターミナルに生のセッション UUID が出ている。撮影レーンが非決定になる',
  ).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  expect(rowsText, 'マスクした表記が出ているはず').toContain('--session-id <session-id>');
});
