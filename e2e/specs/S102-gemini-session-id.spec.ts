import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.afterEach(async () => {
  await closeApp(launched);
});

/**
 * Issue #155。**gemini の tmux セッション名が、claude と同じく安定すること。**
 *
 * 非対称の全文は `src/main/pty/tmux.ts` 冒頭が唯一の正（ここには書き写さない）。
 * この spec が見るのは3つ:
 *
 * 1. 新規起動で `--session-id` に UUID が渡り、tmux セッション名が `aiterm-<その UUID>` になる
 * 2. **履歴から resume すると、履歴側の内部 UUID から同じ形の名前が作られる**
 *    （= 閉じたタブに戻れることの前提。⛔ そのとき `--resume` の引数は index のままで、
 *    UUID を渡していないこと。数字始まりの UUID は index として解釈され、
 *    既存のセッションファイルを失う）
 *
 * 縮退側（CLI が 0.53.0 未満なら渡さない）は **S103** が見る。
 *
 * ⚠ **「実際に同じセッションへ戻れた」ことは、この spec では証明できない。**
 * 偽 tmux は `-A`（attach-or-create）の分岐を再現しない（`e2e/fixtures/bin/tmux` が
 * 自分でその限界を書いている）。ここで証明できるのは「**同じ名前が2回作られる**」まで。
 */
test('S102 gemini の tmux セッション名が新規起動と履歴 resume で安定する', async () => {
  launched = await launchApp({ config: { useTmux: true }, fakeTmux: true });
  const { window, fixturesDir } = launched;

  const activeRows = window
    .locator('.terminal-pane:not(.terminal-pane--hidden) .xterm-rows')
    .first();

  // 起動直後は React のマウントとグローバルショートカットの登録に一瞬かかる。
  // **最初のシェルタブのプロンプトが出るまで待ってから操作する**（S09 / S10 と同じ）。
  // これが無いと、タブは作られるのにアクティブにならず、以降の assert が
  // シェルのペインを見続けて 20 秒待って落ちる（実際に踏んだ）。
  await expect(
    window.locator('.terminal-pane__container .xterm-screen').first(),
  ).toContainText(/[$%#>]/, { timeout: 20_000 });

  // --- 1. 新規起動 -----------------------------------------------------------
  await window.keyboard.press('Meta+Shift+E');
  await expect(window.locator('.tab-bar__tab--gemini')).toHaveCount(1, { timeout: 15_000 });
  await expect(activeRows).toContainText('FAKE GEMINI READY', { timeout: 20_000 });

  // **画面ではなくファイルから読む**（偽 claude / S09 と同じ理由）。
  // 偽 gemini は採番された UUID を画面に出さず、fixtures へ書き出す。
  const sessionIdPath = join(fixturesDir, 'gemini-session-id.txt');
  const newSessionId = readFileSync(sessionIdPath, 'utf8').trim();
  expect(
    newSessionId,
    `偽 gemini が受け取った --session-id が UUID 形式ではない: ${newSessionId}`,
  ).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

  // 撮影レーンの決定性の関門（S09 と同じ）。生の UUID が画面に出ていないこと。
  const rowsText = (await activeRows.textContent()) ?? '';
  expect(
    rowsText,
    'ターミナルに生のセッション UUID が出ている。撮影レーンが非決定になる',
  ).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);

  // tmux セッション名が、いま採番された UUID そのものから作られていること。
  // ⭐ **形（`aiterm-<UUID っぽい何か>`）だけを見ない。** それだと ptyId 由来のままでも
  // 通ってしまい、この Issue の中核（名前が「セッションに対して安定」か）を1つも見ていない。
  expect(readFileSync(join(fixturesDir, 'tmux-session-name.txt'), 'utf8').trim()).toBe(
    `aiterm-${newSessionId}`,
  );

  // --- 2. 履歴から resume ----------------------------------------------------
  await window.locator('.sidebar__tabs button', { hasText: '履歴' }).click();
  await window.locator('.history-list__providers button', { hasText: 'Gemini' }).click();

  const items = window.locator('.history-item');
  await expect(items).toHaveCount(2);
  await items.nth(0).locator('.history-item__row').click();

  await expect(window.locator('.tab-bar__tab--gemini')).toHaveCount(2, { timeout: 15_000 });
  await expect(activeRows).toContainText('FAKE GEMINI READY', { timeout: 20_000 });

  // `e2e/fixtures/gemini-sessions.txt` の1件目の行末 UUID。
  const HISTORY_STABLE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  expect(readFileSync(join(fixturesDir, 'tmux-session-name.txt'), 'utf8').trim()).toBe(
    `aiterm-${HISTORY_STABLE_ID}`,
  );

  // ⛔ resume の引数は index のまま。UUID を渡していないこと。
  const resumeRowsText = (await activeRows.textContent()) ?? '';
  expect(resumeRowsText).toContain('--resume 1');
  expect(
    resumeRowsText,
    '--resume に内部 UUID を渡している。数字始まりの UUID は index として解釈され、既存のセッションファイルを失う',
  ).not.toContain(HISTORY_STABLE_ID);
});
