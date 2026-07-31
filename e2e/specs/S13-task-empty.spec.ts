import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/harness';

/**
 * Issue #20 I-3: タスク0件の空状態には、次の行動（Cmd+Shift+C での起動、
 * および同じ操作をなぞれる起動ボタン）まで併記する。「実行中のタスクは
 * ありません」と事実だけ告げていた頃は、説明書を読まない初見ユーザーが
 * ここから Claude を起動できることに気づく手段が無かった。
 */
test('S13 実行中タスクが0件のとき、次の行動つきの空状態が表示される', async () => {
  const launched = await launchApp({ agentsEmpty: true });
  try {
    const { window } = launched;

    await window.locator('.sidebar__tabs button', { hasText: 'タスク' }).click();

    await expect(window.locator('.task-list .task-item')).toHaveCount(0);
    const empty = window.locator('.task-list .panel-empty');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('動いている AI はまだありません');
    await expect(empty).toContainText('Cmd+Shift+C で Claude を起動できます');

    // エラー表示ではないこと
    await expect(window.locator('.panel-message--error')).toHaveCount(0);
    await expect(empty).not.toHaveClass(/panel-empty--loud/);

    // 起動ボタンを押すと、Cmd+Shift+C と同じ操作（Claude タブが開く）になること。
    const launchButton = empty.locator('.panel-empty__action');
    await expect(launchButton).toBeVisible();
    await expect(launchButton).toContainText('Claude を起動');

    // タイトル文字列は basename(cwd) 等に置き換わりうるため依存しない。
    // プロバイダ専用クラス（.tab-bar__tab--claude）の出現で「Claude タブが
    // 開いたこと」を確認する。
    const tabs = window.locator('.tab-bar__tab');
    await expect(tabs).toHaveCount(1);
    await launchButton.click();
    await expect(tabs).toHaveCount(2);
    await expect(window.locator('.tab-bar__tab--claude')).toHaveCount(1);
  } finally {
    await closeApp(launched);
  }
});
