import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';
import {
  livePanesFile,
  readKilledTmuxSessions,
  waitForNewTmuxSessionName,
} from '../fixtures/tmuxLivePanes';

let launched: LaunchedApp;

test.afterEach(async () => {
  // テスト本体で既に閉じている場合もある（closeApp / forceClose は二重呼び出しに耐える）。
  await closeApp(launched);
});

/**
 * #244 周2。**⛔ 不変条件: 「アプリを閉じる」では tmux セッションを終了しない。**
 *
 * これはこのアプリの中核機能そのもの（`docs/PLAN.md` が挙げた tmux 永続化の動機 =
 * 「AI に長い作業をさせている最中にアプリを再起動できないのは実用上つらい」）。
 * #244 は**タブを閉じる**側の意味だけを変えるのであって、こちらは1ミリも変えない。
 *
 * ⭐ **この spec が要る理由。** #244 の実装で `killTmuxSession()` を Main に足した以上、
 * **`disposePtyAll()` の中にうっかり1行足すだけでこの機能が消える**。
 * しかも消えても画面には何も出ない（アプリはもう終了している）ので、
 * **人が気づける経路が1つも無い**。S107 は「閉じたら終わる」側しか見ていない
 * （code-review 2026-08-09 で指摘）。
 *
 * ⚠ **偽 tmux での「セッションの生存」は `tmux-live-panes.txt` が唯一の正**
 * （シムは exec するだけでセッションの実体を持たない）。ここで見ているのは
 * 「アプリが tmux に終了を要求しないこと」まで。
 */
test('S108 アプリを終了しても tmux セッションは終了しない', async () => {
  launched = await launchApp({ config: { useTmux: true }, fakeTmux: true });
  const { window, fixturesDir } = launched;

  const livePanesPath = join(fixturesDir, 'tmux-live-panes.txt');
  const readKilled = (): string => readKilledTmuxSessions(fixturesDir);
  const readLivePanes = (): string =>
    existsSync(livePanesPath) ? readFileSync(livePanesPath, 'utf8') : '';

  await expect(window.locator('.terminal-pane__container .xterm-screen').first()).toContainText(
    /[$%#>]/,
    { timeout: 20_000 },
  );

  // --- 1. tmux でラップされた claude タブを開く --------------------------------
  await window.keyboard.press('Meta+Shift+C');
  await expect(window.locator('.tab-bar__tab--claude')).toHaveCount(1, { timeout: 15_000 });

  // 偽 tmux が名前を書き終えるまで待つ（S107 と同じ理由）。
  const sessionName = await waitForNewTmuxSessionName(fixturesDir, '');

  // tmux 側に「そのセッションが生きている」状態を作る。
  writeFileSync(
    livePanesPath,
    livePanesFile([
      {
        sessionName,
        startCommand: `claude --session-id ${sessionName.slice('aiterm-'.length)}`,
        cwd: launched.workDir,
      },
    ]),
  );

  // --- 2. 否定側: 開いただけでは終了させていない -------------------------------
  expect(readKilled(), 'タブを開いただけで kill-session が呼ばれている').not.toContain(sessionName);

  // --- 3. アプリを終了する（before-quit -> disposePtyAll） ----------------------
  //
  // ⭐ **`closeApp()` ではなく `app.close()` を直接呼ぶ。** `closeApp()` は
  // 一時 HOME ごと消すので、そのあとフィクスチャを読めない。
  await launched.app.close();

  // --- 4. それでも tmux セッションは終了していない ------------------------------
  expect(
    readKilled(),
    'アプリ終了で tmux セッションを終了させている（「アプリを閉じても AI の作業を続ける」が壊れている）',
  ).not.toContain(sessionName);
  expect(readLivePanes(), 'アプリ終了で tmux 側の一覧から消えている').toContain(sessionName);
});
