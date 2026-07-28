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
 * 「このアプリが起動したタスクが視覚的に区別される」シナリオについて。
 *
 * 実装（src/main/agents/poller.ts の markOwnedSession）を読むと、ownedByApp は
 * 「このアプリが --session-id で起動した sessionId の集合に含まれるか」で
 * 判定される。markOwnedSession を呼ぶのは PTY 起動経路（別ワーカー担当）で、
 * 呼ばれるのはアプリが実際に発行した UUID（crypto.randomUUID()）のみ。
 *
 * 一方 `claude agents --json` はハーネスが固定した agents.json をそのまま返す
 * 偽 CLI であり（e2e/fixtures/bin/claude、e2e/fixtures/harness.ts）、そこに
 * 含まれる2件の sessionId は固定値 aaaaaaaa-... / bbbbbbbb-... で、アプリが
 * これから採番する UUID と一致することは（原理的に）ない。
 *
 * つまりこの偽 CLI 構成では、一覧に「このアプリ発の busy/idle タスク」を
 * 実在させて ownedByApp=true の表示を再現することはできない
 * （agents --json の出力とアプリの起動経路が独立していて、テスト側から
 * 差し込む手段がハーネスに用意されていない）。
 *
 * そのためこの spec で検証できるのは以下に限定する:
 *   1. 固定の2件は、そのままでは（当然ながら）owned として表示されないこと
 *      （task-item--owned クラスが付かず、「このアプリ」バッジも出ない）
 *   2. このアプリから実際に claude タブを起動しても、無関係な固定タスクが
 *      誤って owned 扱いにならないこと（false positive がないことの確認）
 *
 * 「このアプリが起動したタスク自体が owned として表示される」という
 * ポジティブケースは、この隔離ハーネスの構成では検証不能。将来 agents.json
 * を動的に差し替えられるハーネスにするか、markOwnedSession 相当の状態を
 * テストから注入できる仕組みが要る。
 */
test('S15 このアプリが起動したタスクが視覚的に区別される', async () => {
  const { window } = launched;

  // ショートカットの取りこぼしを避けるため、シェルが起動しきるまで待つ（S09 と同様の理由）。
  const initialScreen = window.locator('.terminal-pane__container .xterm-screen').first();
  await expect(initialScreen).toContainText(/[$%#>]/, { timeout: 20_000, useInnerText: true });

  await window.locator('.sidebar__tabs button', { hasText: 'タスク' }).click();

  const items = window.locator('.task-list .task-item');
  await expect(items).toHaveCount(2, { timeout: 15_000 });

  // 固定の2件はいずれも ownedByApp ではない状態で表示される
  await expect(window.locator('.task-item--owned')).toHaveCount(0);
  await expect(window.locator('.task-item__badge')).toHaveCount(0);

  // このアプリから claude を実際に起動してみても、固定タスクの表示は
  // owned 扱いに変化しない（false positive が無いことの確認）
  await window.keyboard.press('Meta+Shift+C');
  await expect(window.locator('.tab-bar__title').filter({ hasText: 'claude' })).toBeVisible();

  await expect(items).toHaveCount(2);
  await expect(window.locator('.task-item--owned')).toHaveCount(0);
  await expect(window.locator('.task-item__badge')).toHaveCount(0);
});
