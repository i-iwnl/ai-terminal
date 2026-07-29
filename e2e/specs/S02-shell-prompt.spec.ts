import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  // simulateAppleTerminalHost: Issue #61 の再発防止用。TERM_PROGRAM=Apple_Terminal を
  // 明示的に固定し、実行者が使っているターミナルアプリに関わらず「Apple Terminal から
  // 起動した」状況を確実に再現する（詳細は harness.ts の LaunchOptions コメント参照）。
  launched = await launchApp({ simulateAppleTerminalHost: true });
});

test.afterEach(async () => {
  await closeApp(launched);
});

/**
 * preload の読み込みに失敗すると window.api が生えず、PTY が一切起動しない。
 * その状態でもウィンドウ自体は開くため「起動した」だけでは検出できない。
 * 実際にこの不具合を作り込んだことがあるので、シェルが応答するところまで見る。
 */
test('S02 シェルが起動してプロンプトが表示される', async () => {
  const { window } = launched;

  // preload が読み込まれ、contextBridge の API が露出していること
  const hasApi = await window.evaluate(() => typeof window.api === 'object' && window.api !== null);
  expect(hasApi).toBe(true);

  // PTY からの出力が xterm に描画されること（プロンプト記号が出るまで待つ）
  const screen = window.locator('.terminal-pane__container .xterm-screen').first();
  await expect(screen).toBeVisible();
  await expect(screen).toContainText(/[$%#>]/, { timeout: 20_000 });

  // Issue #61: TERM_PROGRAM=Apple_Terminal を継承したまま起動すると、
  // macOS の /etc/zshrc_Apple_Terminal がセッション復元を走らせ、何も復元して
  // いないのに「Restored session: ...」という嘘の行が1行目に出る。
  // beforeEach で TERM_PROGRAM=Apple_Terminal を明示的に与えた状態でも
  // 出ないことを見る（buildPtyEnv が上書きしていることの結合レベルの担保）。
  const rows = window.locator('.terminal-pane__container .xterm-rows').first();
  await expect(rows).not.toContainText('Restored session');
});
