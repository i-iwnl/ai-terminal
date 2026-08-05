import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp({ config: { useTmux: true }, fakeTmux: true, geminiOldVersion: true });
});

test.afterEach(async () => {
  await closeApp(launched);
});

/**
 * ⚠ **古い CLI には `--session-id` を渡さない**（渡すと usage を出して即終了する）。
 *
 * 偽 gemini は `AI_TERMINAL_E2E_GEMINI_OLD=1` で `--version` を 0.52.0 に落とす。
 * 判定そのものは `test/unit/gemini-version.test.ts` が桁ごとに固定しているので、
 * ここでは「判定が起動経路まで実際に効いていること」だけを見る。
 */
test('S103 CLI が古ければ gemini に --session-id を渡さない', async () => {
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

  await window.keyboard.press('Meta+Shift+E');
  await expect(window.locator('.tab-bar__tab--gemini')).toHaveCount(1, { timeout: 15_000 });
  await expect(activeRows).toContainText('FAKE GEMINI READY', { timeout: 20_000 });

  // 偽 gemini は --session-id を受け取ったときだけこのファイルを書く。
  expect(
    existsSync(join(fixturesDir, 'gemini-session-id.txt')),
    '0.53.0 未満の CLI に --session-id を渡している（本物なら usage を出して即終了する）',
  ).toBe(false);

  const rowsText = (await activeRows.textContent()) ?? '';
  expect(rowsText).not.toContain('--session-id');

  // 縮退の結果として、tmux セッション名は ptyId 由来になる（= 閉じると回収できない）。
  // **ここまで見ないと「渡さない」だけの実装でも通る。**
  expect(readFileSync(join(fixturesDir, 'tmux-session-name.txt'), 'utf8').trim()).toMatch(
    /^aiterm-[0-9a-f]{8}-/i,
  );
});
