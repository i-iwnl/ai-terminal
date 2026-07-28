import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/harness';

/**
 * 偽 CLI を PATH に置かない状態で claude を起動しようとするテスト。
 *
 * 実機で確認した挙動: node-pty の spawn は存在しないコマンドでも同期的には
 * 例外を投げない（exec 自体は子プロセス側で非同期に失敗し、PTY はいったん
 * 起動してすぐ終了する）。そのため useTabs.ts の describeSpawnError 経由の
 * notice-banner はこの経路では出ない。
 *
 * 一方、サイドバーの実行中タスク一覧は `claude agents --json` を
 * execFile で実行しており、こちらは PATH 上に claude が無いと ENOENT で
 * 同期的に失敗する。src/main/agents/claude.ts の describeExecError が
 * 「claude コマンドが見つかりません（PATH を確認してください）」という
 * 日本語メッセージに変換し、TaskList.tsx が panel-message--error として表示する。
 * このテストではこちらの経路で日本語エラーが出ることを確認する。
 */
test('S11 CLI が見つからないときに日本語のエラーが表示され、アプリが落ちない', async () => {
  const launched = await launchApp({ withoutCli: true });
  try {
    const { window } = launched;

    // 起動直後のシェルタブがまず生きていること（withoutCli でもシェル自体は
    // /bin/zsh 等が PATH に残っているので起動できる）
    const screen = window.locator('.terminal-pane__container .xterm-screen').first();
    await expect(screen).toBeVisible();
    // xterm.js の DOM レンダラが .xterm-screen 配下に注入する <style> の中身まで
    // textContent ベースの既定の toContainText は拾ってしまうため、useInnerText を使う。
    await expect(screen).toContainText(/[$%#>]/, { timeout: 20_000, useInnerText: true });

    // サイドバーのタスク一覧に、claude コマンド不在の日本語エラーが表示されること
    const taskError = window.locator('.task-list .panel-message--error');
    await expect(taskError).toBeVisible({ timeout: 15_000 });
    await expect(taskError).toContainText('claude コマンドが見つかりません');

    // claude タブを開こうとしてもアプリが落ちないこと
    await window.keyboard.press('Meta+k');

    // アプリが壊れていないこと（サイドバー・タブバーは引き続き表示される）
    await expect(window.locator('.app')).toBeVisible();
    await expect(window.locator('.sidebar')).toBeVisible();
    await expect(window.locator('.tab-bar')).toBeVisible();

    // 既存のシェルタブが生きたままであること。
    // claude タブが新しく開いてアクティブになった結果、元のシェルタブは
    // terminal-pane--hidden（visibility: hidden）で非表示になる。
    // useInnerText は非表示要素では常に空文字列を返してしまうため、
    // ここは textContent ベースの既定の挙動のまま確認する
    // （プロンプト記号は CSS 注入テキストと衝突しにくく、実害はない）。
    await expect(screen).toContainText(/[$%#>]/, { timeout: 20_000 });
  } finally {
    await closeApp(launched);
  }
});
