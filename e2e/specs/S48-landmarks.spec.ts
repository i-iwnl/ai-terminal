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
 * Issue #56 PR 0-c（分割表示の前提工事）。分割そのものは1行も入らないが、
 * 「ランドマークが0件」「支援技術に露出している status/alert live region が
 * どれか分からない」状態のままだと、分割でペインが増えたときに手がかりが
 * さらに埋もれる。ここではその前提となる構造（role とラベル）だけを見る。
 *
 * aria-label とランドマークの role を読むだけなので、PTY の出力やタイミングに
 * 依存せず安定する（design-review.md の「3. 改訂した導入計画」0-c 行が要求する
 * 「新規1本（aria-label を読むだけなので安定）」の関門はこれを指す）。
 */
test('S48 サイドバーが nav、ターミナル領域が main のランドマークとして存在し、status live region がちょうど1個ある', async () => {
  const { window } = launched;

  await expect(window.locator('.app')).toBeVisible();

  // サイドバー: <nav aria-label="サイドバー">（Sidebar.tsx）
  const nav = window.getByRole('navigation');
  await expect(nav).toHaveCount(1);
  await expect(nav).toHaveAttribute('aria-label', 'サイドバー');
  await expect(nav).toHaveClass(/sidebar/);

  // ターミナル領域: <main className="main">（App.tsx）
  const main = window.getByRole('main');
  await expect(main).toHaveCount(1);
  await expect(main).toHaveClass(/main/);

  // .app 直下の role="status" live region はちょうど1個だけ露出していること。
  // xterm 内部の .xterm-accessibility（aria-live="assertive"、S37 が別途1個を保証）
  // とは別系統で、こちらはタブ単位の告知用（App.tsx の exitAnnouncement）。
  const status = window.getByRole('status');
  await expect(status).toHaveCount(1);
  await expect(status).toHaveClass(/app-status/);
});
