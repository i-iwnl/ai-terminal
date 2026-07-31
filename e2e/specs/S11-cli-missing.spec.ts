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
 * 同期的に失敗する。src/main/agents/claude.ts の describeExecError がこれを
 * 検知し、TaskList.tsx が「claude が PATH に無い」専用の空状態パネル
 * （Issue #20 I-3）として表示する。
 *
 * このパネルは赤字の生エラー文一行ではなく、見出し + 手順 + 「再確認」ボタンで、
 * かつ「一度出したら黙る」（初回検知だけ目立たせ、以降の自動ポーリングでの
 * 再検知は静かな見た目に落ちる）。時間に依存する挙動なので、実際に3秒待って
 * 黙ることを確認する。
 *
 * **pollIntervalMs は harness の既定（700ms、テストを速くするための短縮値）を
 * 使わず、本番の既定値である3000msを明示的に指定する。** 700msのままだと、
 * Electron の起動・Playwright のアタッチにかかる時間だけで初回検知の
 * 「目立つ」ウィンドウ（次のポーリングまでの間）を素通りしてしまい、
 * このテスト自身が「一度も loud を観測できないまま常に quiet」という
 * 偽陰性になることを実測で確認した（最初はこれで倒れた）。
 */
test('S11 CLI が見つからないときに専用の空状態パネルが表示され、一度出したら黙り、アプリが落ちない', async () => {
  const launched = await launchApp({ withoutCli: true, config: { pollIntervalMs: 3000 } });
  try {
    const { window } = launched;

    // シェルタブより先に、タスク一覧の空状態パネルを確認する。
    // シェルのプロンプト待ち（zsh 起動）は数秒かかることがあり、先に待つと
    // その間に何度もポーリング周期が過ぎてしまい、初回だけの「目立つ」瞬間を
    // 通り過ぎてしまう（実測で確認済み）。
    const notFoundPanel = window.locator('.task-list .panel-empty');
    await expect(notFoundPanel).toBeVisible({ timeout: 15_000 });
    await expect(notFoundPanel.locator('.panel-empty__heading')).toContainText(
      'Claude CLI が見つかりません',
    );
    // 初回検知は目立たせる（panel-empty--loud = 見出しが赤字）。
    await expect(notFoundPanel).toHaveClass(/panel-empty--loud/);

    // 「一度出したら黙る」の実測: pollIntervalMs（3000ms）を確実に超える3.5秒待つ。
    // 同じ ENOENT を検知し続けているはずだが、2回目以降の自動検知では
    // 見出しが赤字のままにならないこと。
    await window.waitForTimeout(3_500);
    await expect(notFoundPanel).not.toHaveClass(/panel-empty--loud/);
    // 黙る = 見た目が静かになるだけで、情報自体は消えない。
    await expect(notFoundPanel.locator('.panel-empty__heading')).toContainText(
      'Claude CLI が見つかりません',
    );

    // 「再確認」ボタンはユーザーの明示的な操作への直接応答なので、
    // 自動ポーリングの再検知とは違い、押すと再び目立たせる。
    await notFoundPanel.locator('.panel-empty__action').click();
    await expect(notFoundPanel).toHaveClass(/panel-empty--loud/);

    // 起動直後のシェルタブがまず生きていること（withoutCli でもシェル自体は
    // /bin/zsh 等が PATH に残っているので起動できる）
    const screen = window.locator('.terminal-pane__container .xterm-screen').first();
    await expect(screen).toBeVisible();
    // xterm.js の DOM レンダラが .xterm-screen 配下に注入する <style> の中身まで
    // textContent ベースの既定の toContainText は拾ってしまうため、useInnerText を使う。
    await expect(screen).toContainText(/[$%#>]/, { timeout: 20_000, useInnerText: true });

    // claude タブを開こうとしてもアプリが落ちないこと
    await window.keyboard.press('Meta+Shift+C');

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
