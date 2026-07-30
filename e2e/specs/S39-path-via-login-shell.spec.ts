import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp({ cliOnlyViaLoginShell: true });
});

test.afterEach(async () => {
  await closeApp(launched);
});

/**
 * Issue #40 の再発防止。
 *
 * 起動時の PATH は最小構成（/usr/bin:/bin:/usr/sbin:/sbin）で、偽 claude には
 * 一時 HOME の .zshrc が足す PATH 経由でしか到達できない。つまりアプリが
 * 起動時にログインシェルから PATH を解決（src/main/shell-path.ts）できて
 * 初めてポーリングが成功し、タスク一覧が表示される。
 *
 * 解決が壊れているとタスク一覧は「claude コマンドが見つかりません」になる。
 * #40 では解決コマンドの $PATH が目印を変数名として食って常に失敗していたが、
 * 偽 CLI が PATH に居る通常シナリオでは検出できなかった。
 */
test('S39 CLI が起動時の PATH に無くても、ログインシェルから解決して一覧が出る', async () => {
  const { window } = launched;

  await window.locator('.sidebar__tabs button', { hasText: 'タスク' }).click();

  // ログインシェル解決（1秒前後）+ ポーリング間隔があるので余裕を持って待つ
  const items = window.locator('.task-list .task-item');
  await expect(items).toHaveCount(2, { timeout: 15_000 });
  // このテストが確かめたいのは「偽 claude に到達できて一覧が出た」ことだけで、
  // 並び順ではない。Issue #20 B（PR 8）で一覧は状態でグループ化され、
  // 「あなたの番」が先頭に来るようになったため、**先頭行で引かないこと**
  // （フィクスチャの定義順では busy の demo-project が先だが、表示順では後ろになる）。
  await expect(window.locator('.task-item__name', { hasText: 'demo-project' })).toHaveCount(1);

  // PATH エラーの縮退表示になっていないこと（ここが出る = 解決が機能していない）
  await expect(window.locator('.task-list .panel-message--error')).toHaveCount(0);
});
