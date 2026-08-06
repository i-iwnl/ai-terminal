import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.afterEach(async () => {
  await closeApp(launched);
});

/**
 * #180 周13。**gemini のセッションが「タブに戻せる AI」の節に出る。**
 *
 * これが `known-issues.md` 12番の本体。gemini はタスク一覧に1件も出ない
 * （Main は `claude agents --json` しか叩かない）ため、**会話が0往復で
 * `gemini --list-sessions` にも出ないセッションは、アプリ内に導線が1つも無かった**。
 * tmux には `aiterm-<uuid>` として残っているので、そこから拾う。
 *
 * ⭐ **否定側を同じ spec で見る。** tmux に何も無いときは節ごと出ないこと、
 * **タスク一覧に既にある行はこの節に重複して出ないこと**の2つ。
 * これが無いと「常に節を出す」「全部出す」実装でも緑になる。
 *
 * ⛔ 見出しに「実行中」を使わない（`design-rules` の禁止語）。
 * ⛔ 「回収」は内部語なので画面にも読み上げにも出さない。
 */
test('S105 tmux で生きている gemini が「タブに戻せる AI」の節に出る', async () => {
  launched = await launchApp({ config: { useTmux: true }, fakeTmux: true });
  const { window, fixturesDir } = launched;

  await expect(window.locator('.terminal-pane__container .xterm-screen').first()).toContainText(
    /[$%#>]/,
    { timeout: 20_000 },
  );

  const section = window.locator('.task-group', { hasText: 'タブに戻せる AI' });

  // --- 1. tmux に何も無ければ節ごと出ない（否定側） ---------------------------
  await expect(section).toHaveCount(0, { timeout: 20_000 });

  // --- 2. gemini と、タスク一覧に既にある claude を tmux に置く ---------------
  // 既定の agents.json は sessionId が aaaaaaaa-… / bbbbbbbb-… の2件。
  // その片方を tmux にも置き、**この節には重複して出ない**ことを見る。
  const SEP = '\x1f';
  writeFileSync(
    join(fixturesDir, 'tmux-live-panes.txt'),
    [
      ['aiterm-99999999-9999-4999-8999-999999999999', 'gemini --session-id 99999999', '/work/g'].join(SEP),
      ['aiterm-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'claude --session-id aaaaaaaa', '/work/c'].join(SEP),
    ].join('\n') + '\n',
  );

  await expect(section).toHaveCount(1, { timeout: 20_000 });

  // gemini の1件だけが出る（claude 側はタスク一覧に既にあるので重複させない）。
  const rows = section.locator('.task-item');
  await expect(rows).toHaveCount(1, { timeout: 20_000 });
  await expect(section.locator('.task-group__heading')).toHaveText('タブに戻せる AI 1件');

  // プロバイダは語で伝える（色や帯では分けない）。
  const button = rows.locator('button.task-item__row');
  await expect(button).toHaveCount(1);
  await expect(button).toHaveAttribute('aria-label', /Gemini/);
  await expect(button).toHaveAttribute('aria-label', /タブに戻す/);
  // ⛔ 内部語・禁止語を画面へ出さない。
  await expect(button).not.toHaveAttribute('aria-label', /回収/);
  await expect(section.locator('.task-group__heading')).not.toContainText('実行中');

  // --- 3. パネル見出しにプロバイダ名を焼き込まない ----------------------------
  // gemini が並ぶ面で「…の Claude」と名乗ると、その瞬間に嘘になる。
  await expect(window.locator('.panel-scope')).not.toContainText('Claude');
});
