import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp({ simulateLaunchedFromAgentSession: true });
});

test.afterEach(async () => {
  await closeApp(launched);
});

/**
 * Issue #253 の再発防止。
 *
 * `.app` を Claude Code セッションの中から起動すると（`make install-app` や、
 * エージェントに開かせた場合）、親セッションが子プロセス向けに export している env が
 * アプリの `process.env` に焼き付く。`buildPtyEnv` は起動元の env を丸ごと引き継ぐので、
 * **それが全タブの子プロセスに配られる。**
 *
 * 受け取った `claude` は自分を「親セッションの子セッション」と判定し、
 * `~/.claude/sessions/<pid>.json` を書かない（= `claude agents --json` に出ない =
 * 一覧に出ない）うえ、トランスクリプトも保存しない（= 履歴にも `--resume` にも残らない）。
 *
 * ⭐ **ここでしか見られないのは「除去がどこで走るか」。** 何を落とすかの定義は
 * `test/unit/inherited-agent-env.test.ts` が持つが、**`src/main/index.ts` の呼び出しを
 * 丸ごと消しても単体テストは緑のまま**になる。さらに除去を
 * `ensureLoginShellPath()` より後ろに動かすと、探索シェル（`$SHELL -i -l -c`）が
 * 同じ値を再エクスポートし、`mergeUserEnv` が埋め戻して**無効化される**。
 * その2つを踏めるのはこのシナリオだけ。
 */
test('S120 Claude Code セッションから起動しても、タブの子プロセスに親セッションの env を渡さない', async () => {
  const { window } = launched;

  const screen = window.locator('.terminal-pane__container .xterm-screen').first();
  await expect(screen).toContainText(/[$%#>]/, { timeout: 20_000 });

  await window.locator('.xterm-helper-textarea').first().focus();

  // ⭐ **先に「env が届いていること自体」を確かめる。** これが無いと、
  // 環境変数が1つも渡っていない（＝何を測っても空になる）状態でも緑になる。
  // AI_TERMINAL_E2E_NODE はハーネスが必ず渡す値で、除去の対象ではない。
  await window.keyboard.type('echo "control=[${AI_TERMINAL_E2E_NODE:+set}]"');
  await window.keyboard.press('Enter');
  await expect(screen).toContainText('control=[set]', { timeout: 10_000 });

  // 本題。親セッションのマーカーが子プロセスに届いていないこと。
  // 値そのものではなく「設定されているか」を出す（未設定なら空になる）。
  await window.keyboard.type(
    'echo "marker=[${CLAUDE_CODE_CHILD_SESSION:+set}${CLAUDECODE:+set}${CLAUDE_PID:+set}]"',
  );
  await window.keyboard.press('Enter');
  await expect(screen).toContainText('marker=[]', { timeout: 10_000 });
});
