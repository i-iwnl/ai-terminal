import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { launchApp, closeApp, setAgentEntries, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.afterEach(async () => {
  await closeApp(launched);
});

/**
 * #180 周12。**タブを閉じても、tmux セッションが生きていればタスク一覧から戻せる。**
 *
 * 直す前は、行を押せる条件が「そのセッションを開いているタブがアプリ内にあるか」
 * だけだった。**タブの構成はどこにも永続化していない**ので、アプリを再起動した
 * 瞬間に、走っているセッションが全部「一覧には出るが押せない行」になっていた
 * （「このアプリ」バッジが付いているのに押せない）。
 *
 * 判定の正は `resolveTaskRowAction`（`src/renderer/src/sidebar/taskRow.ts`）で、
 * 3値の組み合わせは `test/unit/task-row.test.ts` が固定している。
 * ここでは**実際に画面の行が押せる形になるところまで**を見る。
 *
 * ⚠ **このシムで担保できないこと**: 偽 tmux は一覧の中身をフィクスチャから返すだけで、
 * `-A` で実際にアタッチできるかは再現しない（`e2e/fixtures/bin/tmux` 冒頭）。
 * 「本当に元の画面へ戻る」は実機確認でしか出ない。
 *
 * ⭐ **否定側を同じ spec で見る。** 一覧に載っていないときは押せないままであることを
 * 先に assert する。これが無いと「常に押せる」実装でも緑になる。
 */
test('S104 タブを閉じても tmux セッションが生きていればタスク一覧から戻せる', async () => {
  launched = await launchApp({ config: { useTmux: true }, fakeTmux: true });
  const { window, fixturesDir } = launched;

  // 最初のシェルのプロンプトが出るまで待ってから操作する（待たないとタブは
  // 作られるのにアクティブにならず、20 秒待って落ちる）。
  await expect(window.locator('.terminal-pane__container .xterm-screen').first()).toContainText(
    /[$%#>]/,
    { timeout: 20_000 },
  );

  // --- 1. claude タブを開き、アプリが採番した ID を知る -------------------------
  await window.keyboard.press('Meta+Shift+C');
  await expect(window.locator('.tab-bar__tab--claude')).toHaveCount(1, { timeout: 15_000 });

  // 画面ではなくファイルから読む（偽 CLI は生の UUID を画面に出さない）。
  const sessionName = readFileSync(join(fixturesDir, 'tmux-session-name.txt'), 'utf8').trim();
  expect(sessionName, `tmux セッション名が aiterm- で始まっていない: ${sessionName}`).toMatch(
    /^aiterm-[0-9a-f-]{36}$/i,
  );
  const sessionId = sessionName.slice('aiterm-'.length);

  // そのセッションが `claude agents --json` にも出ている状態にする
  // （= タスク一覧に「このアプリ」バッジ付きの行が立つ）。
  setAgentEntries(launched, [
    {
      pid: 4321,
      cwd: launched.workDir,
      kind: 'interactive',
      startedAt: Date.now() - 60_000,
      sessionId,
      name: 'recoverable-session',
      status: 'idle',
    },
  ]);

  const row = window.locator('.task-item', { hasText: 'recoverable-session' });
  await expect(row).toHaveCount(1, { timeout: 20_000 });
  // タブが開いている間は「移動」で押せる。
  await expect(row.locator('button.task-item__row')).toHaveCount(1, { timeout: 20_000 });

  // --- 2. タブを閉じる。一覧に載っていなければ押せないまま（否定側） ----------
  await window.keyboard.press('Meta+w');
  await expect(window.locator('.tab-bar__tab--claude')).toHaveCount(0, { timeout: 15_000 });

  // 偽 tmux は tmux-live-sessions.txt が無い間「サーバが動いていない」を返す。
  await expect(row.locator('button.task-item__row')).toHaveCount(0, { timeout: 20_000 });
  await expect(row.locator('.task-item__row')).toHaveCount(1);

  // --- 3. tmux に生きている状態を作ると、押せる行に戻る ------------------------
  writeFileSync(join(fixturesDir, 'tmux-live-sessions.txt'), `${sessionName}\n`);

  const recoverButton = row.locator('button.task-item__row');
  await expect(recoverButton).toHaveCount(1, { timeout: 20_000 });
  // 押すと何が起きるかが読み上げ名に出ていること（「回収」は内部語なので出さない）。
  await expect(recoverButton).toHaveAttribute('aria-label', /タブに戻す/, { timeout: 20_000 });
  await expect(recoverButton).not.toHaveAttribute('aria-label', /回収/);
});
