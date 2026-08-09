import { test, expect } from '@playwright/test';
import { launchApp, closeApp, setAgentEntries, type LaunchedApp } from '../fixtures/harness';
import { waitForNewTmuxSessionName } from '../fixtures/tmuxLivePanes';

let launched: LaunchedApp;

test.afterEach(async () => {
  await closeApp(launched);
});

/**
 * #244 周4。**作業中の AI を止めるときだけ確認する。**
 *
 * ⭐ **「閉じたら終わる」に変えた分の安全弁。** iTerm2 / Terminal.app / Ghostty / tmux の
 * 4つとも、閉じる操作に「確認」か「Undo」の**少なくとも片方**を持っている。
 * 両方持たない設計は前例が無い（design-review のヘビーユーザーが指摘）。
 *
 * ⭐ **条件は「枚数」ではなく「走っているか」**（Terminal.app の作法）。
 * 閉じるのは「終わったから」が大半なので、**確認が出る頻度が損失の重さに比例する**。
 *
 * ⭐ **否定側を同じ spec で見る。** 同じ1枚のタブが、`idle` なら確認なしで閉じ、
 * `busy` なら確認が出る。**状態だけを変えて2回測る**ので、
 * 「常に確認する」実装も「一度も確認しない」実装も落とせる。
 * これが無いと、ホットパスに毎回ダイアログを出す実装でも緑になる。
 */
test('S111 作業中の AI を閉じるときだけ確認が出る', async () => {
  launched = await launchApp({ config: { useTmux: true }, fakeTmux: true });
  const { window, fixturesDir } = launched;

  const dialog = window.locator('[role="alertdialog"]');
  const claudeTabs = window.locator('.tab-bar__tab--claude');

  await expect(window.locator('.terminal-pane__container .xterm-screen').first()).toContainText(
    /[$%#>]/,
    { timeout: 20_000 },
  );

  // --- 否定側: idle のセッションは確認なしで閉じる -----------------------------
  await window.keyboard.press('Meta+Shift+C');
  await expect(claudeTabs).toHaveCount(1, { timeout: 15_000 });
  const idleName = await waitForNewTmuxSessionName(fixturesDir, '');
  const idleId = idleName.slice('aiterm-'.length);

  setAgentEntries(launched, [
    {
      pid: 4321,
      cwd: launched.workDir,
      kind: 'interactive',
      startedAt: Date.now() - 60_000,
      sessionId: idleId,
      name: 'idle-session',
      status: 'idle',
    },
  ]);
  // 一覧に反映されるまで待つ（反映前に閉じると、状態を見ずに閉じただけになる）。
  await expect(window.locator('.task-item', { hasText: 'idle-session' })).toHaveCount(1, {
    timeout: 20_000,
  });

  await window.keyboard.press('Meta+w');
  await expect(claudeTabs).toHaveCount(0, { timeout: 15_000 });
  await expect(dialog).toHaveCount(0);

  // --- 本題: busy のセッションは確認が出る -------------------------------------
  await window.keyboard.press('Meta+Shift+C');
  await expect(claudeTabs).toHaveCount(1, { timeout: 15_000 });
  const busyName = await waitForNewTmuxSessionName(fixturesDir, idleName);
  const busyId = busyName.slice('aiterm-'.length);

  setAgentEntries(launched, [
    {
      pid: 4322,
      cwd: launched.workDir,
      kind: 'interactive',
      startedAt: Date.now() - 60_000,
      sessionId: busyId,
      name: 'busy-session',
      status: 'busy',
    },
  ]);
  // ⭐ 画面上でも「作業中」として扱われていることを確かめる。ここを見ないと、
  // 状態が届く前に閉じて「たまたま確認が出なかった」を見逃す。
  await expect(window.locator('.task-item--working', { hasText: 'busy-session' })).toHaveCount(1, {
    timeout: 20_000,
  });

  await window.keyboard.press('Meta+w');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  // ⭐ **何が戻らないかを言う。**「取り消せます」とは言えない（プロセスは戻らない）。
  await expect(dialog).toContainText('作業中');
  await expect(dialog).toContainText('やり直しになります');
  // タブはまだ閉じていない（確認が形だけになっていないこと）。
  await expect(claudeTabs).toHaveCount(1);

  // キャンセルできる。
  await window.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(claudeTabs).toHaveCount(1);
});
