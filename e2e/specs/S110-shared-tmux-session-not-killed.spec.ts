import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';
import {
  livePanesFile,
  readKilledTmuxSessions,
  readTmuxSessionName,
  waitForNewTmuxSessionName,
} from '../fixtures/tmuxLivePanes';

let launched: LaunchedApp;

test.afterEach(async () => {
  await closeApp(launched);
});

/**
 * #244 周2。**同じ tmux セッションを別のタブも開いているなら、片方を閉じても終了させない。**
 *
 * ⭐ **1つの tmux セッションに複数のクライアントが繋がりうる**（code-review 2026-08-09 で指摘）。
 * `wrapCommandWithTmux` が使う `new-session -A` は「同名があればアタッチ」なので、
 * **同じ履歴エントリを2回 resume すると、2枚のタブが同じ `aiterm-<id>` に繋がる**
 * （`resumeHistory` にそれを止めるガードは無い。`src/renderer/src/App.tsx`）。
 *
 * その状態で片方を閉じたときにセッションごと終了させると、
 * **利用者が閉じていないほうのタブの AI まで巻き添えで死ぬ。** しかも死に方は
 * 「作業中だったペインが突然 `[プロセスは終了しました]` になる」なので、
 * **原因が閉じた別のタブにあることには誰も辿り着けない。**
 *
 * ⭐ **否定側と肯定側を同じ spec で見る。** 「共有中は終了させない」だけだと
 * **一度も終了させない実装**でも緑になるので、最後の1枚を閉じたら終了することまで見る。
 */
test('S110 同じ tmux セッションを別のタブも使っていれば、片方を閉じても終了させない', async () => {
  launched = await launchApp({ config: { useTmux: true }, fakeTmux: true });
  const { window, fixturesDir } = launched;

  const livePanesPath = join(fixturesDir, 'tmux-live-panes.txt');
  const readKilled = (): string => readKilledTmuxSessions(fixturesDir);

  await expect(window.locator('.terminal-pane__container .xterm-screen').first()).toContainText(
    /[$%#>]/,
    { timeout: 20_000 },
  );

  // --- 1. 同じ履歴エントリを2回 resume して、同じ tmux セッションに2枚繋ぐ -------
  await window.locator('.sidebar__tabs button', { hasText: '履歴' }).click();
  const items = window.locator('.history-item');
  await expect(items.first()).toBeVisible({ timeout: 20_000 });

  const claudeTabs = window.locator('.tab-bar__tab--claude');
  await items.nth(0).locator('.history-item__row').click();
  await expect(claudeTabs).toHaveCount(1, { timeout: 20_000 });

  const sessionName = await waitForNewTmuxSessionName(fixturesDir, '');

  await items.nth(0).locator('.history-item__row').click();
  await expect(claudeTabs).toHaveCount(2, { timeout: 20_000 });

  // ⭐ **2枚目が同じ tmux セッション名になっていること**を確かめる。ここが崩れると
  // 以降の assert は「共有していないから終了しなかった」でも通ってしまう。
  expect(
    readTmuxSessionName(fixturesDir),
    '2枚目が別の tmux セッション名になっている（共有の前提が崩れている）',
  ).toBe(sessionName);

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

  // --- 2. 片方を閉じても、セッションは終了しない -------------------------------
  await window.keyboard.press('Meta+w');
  await expect(claudeTabs).toHaveCount(1, { timeout: 20_000 });

  // ⚠ 「まだ叩いていない」は時間が経てば変わりうるので、**もう片方を閉じるまでの間に
  // 十分な猶予を取る**。ここでは次の操作（タブが1枚に減ったことの確認）が既に
  // ポーリング待ちを挟んでいるので、その後で見る。
  expect(
    readKilled(),
    '別のタブがまだ同じ tmux セッションを使っているのに終了させている（閉じていないほうの AI が巻き添えで死ぬ）',
  ).not.toContain(sessionName);

  // --- 3. 最後の1枚を閉じたら終了する（肯定側） --------------------------------
  //
  // これが無いと「一度も終了させない」実装でも上まで緑になる。
  await window.keyboard.press('Meta+w');
  await expect(claudeTabs).toHaveCount(0, { timeout: 20_000 });

  await expect
    .poll(readKilled, {
      timeout: 15_000,
      message: '最後の1枚を閉じても tmux セッションを終了させていない',
    })
    .toContain(sessionName);
});
