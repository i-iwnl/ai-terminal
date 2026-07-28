import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp({ config: { scopeAgentsToCwd: true } });
});

test.afterEach(async () => {
  await closeApp(launched);
});

/**
 * scopeAgentsToCwd による絞り込み。
 *
 * フィクスチャの agents.json は cwd 違いの2件を持つ（アプリの作業ディレクトリで
 * 動いている demo-project-busy と、無関係な /tmp/other-project の other-project-idle）。
 * 絞り込みを有効にして起動したとき、前者だけが残ることを見る。
 *
 * **「1件になったこと」だけを見ない。** どちらが残ったかまで確認する。
 * 絞り込みが逆向きに壊れていても件数は 1 のままになりうる。
 * 絞り込まない場合に2件出ることは S12 が担保している。
 *
 * この設定は Renderer が agents:list に cwd を添えて初めて効く（Main 側の
 * 絞り込み対象はその引数からしか更新されない）。実際に Renderer が空の引数で
 * 呼んでおり、設定が一度も効いていなかったことがある。
 */
test('S34 現在のディレクトリで絞り込むと、無関係なタスクが一覧から消える', async () => {
  const { window } = launched;

  await window.locator('.sidebar__tabs button', { hasText: 'タスク' }).click();

  const items = window.locator('.task-list .task-item');
  await expect(items).toHaveCount(1, { timeout: 15_000 });
  await expect(items.first()).toContainText('demo-project-busy');
  await expect(window.locator('.task-list')).not.toContainText('other-project-idle');
});
