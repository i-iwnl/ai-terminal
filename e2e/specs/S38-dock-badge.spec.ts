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
 * Dock バッジは「あなたの番」の件数を出す。
 *
 * ウィンドウ内のどの表現も「アプリを見ている」ことが前提だが、実利用では
 * エディタやブラウザを見ている時間のほうが長い。Dock バッジは**クロームの
 * ピクセルを1つも使わずに件数を伝えられる唯一の面**（Issue #24）。
 *
 * 固定の agents.json は demo-project-busy（status: busy = 作業中）と
 * other-project-idle（status: idle = あなたの番）の2件を返す（harness.ts）。
 * したがって期待値は **1**。
 *
 * ここが 2 になっていたら「件数 = タスク総数」に、0 になっていたら
 * 判定が逆（busy を数えている）になっている。**総数ではないこと**を見るのが要点で、
 * 単に「0 より大きい」を見ると、逆に塗っても緑になる。
 */
test('S38 Dock バッジにあなたの番の件数が出る', async () => {
  const { window, app } = launched;

  // 一覧が届くまで待つ（バッジの更新はポーリング結果に連動する）
  await expect(window.locator('.task-list .task-item')).toHaveCount(2, { timeout: 15_000 });

  await expect
    .poll(async () => app.evaluate(({ app: electronApp }) => electronApp.getBadgeCount()), {
      timeout: 15_000,
    })
    .toBe(1);

  // 念のため、一覧側の件数と一致していることも見る。
  // 表示と Dock が別々の判定を持っていると、片方だけが CLI の仕様変更に追従して食い違う。
  await expect(window.locator('.task-item--your-turn')).toHaveCount(1);
});
