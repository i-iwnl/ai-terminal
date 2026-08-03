import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import {
  launchApp,
  closeApp,
  setAgentEntries,
  agentEntriesWithStatus,
  type LaunchedApp,
} from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

/**
 * 「このアプリが起動したタスクが視覚的に区別される」シナリオについて。
 *
 * 実装（src/main/agents/poller.ts の markOwnedSession）を読むと、ownedByApp は
 * 「このアプリが --session-id で起動した sessionId の集合に含まれるか」で
 * 判定される。markOwnedSession を呼ぶのは PTY 起動経路（src/main/pty/manager.ts が
 * claude の spawn 時に呼ぶ）で、呼ばれるのはアプリが実際に発行した UUID
 * （crypto.randomUUID()）のみ。
 *
 * 一方 `claude agents --json` はハーネスが固定した agents.json をそのまま返す
 * 偽 CLI であり（e2e/fixtures/bin/claude、e2e/fixtures/harness.ts）、そこに
 * 含まれる2件の sessionId は固定値 aaaaaaaa-... / bbbbbbbb-...。
 *
 * 以前はこの2つが独立していて、肯定側（ownedByApp=true の表示）を
 * この偽 CLI 構成では再現できなかった。**Issue #120 周5 で状況が変わった**:
 * - `harness.ts` に `setAgentEntries()` が入り、実行中に agents.json を
 *   動的に差し替えられるようになった（偽 CLI は呼ばれるたびに読み直す）
 * - 偽 claude が実際に受け取った --session-id の UUID を
 *   `claude-session-id.txt` へ書き出すようになった（S09 と同じ手段で読める）
 *
 * これにより、「このアプリが実際に起動した claude セッションの sessionId」を
 * 読み取って agents.json の固定エントリに差し込めば、その行だけが
 * ownedByApp=true になる状況を作れる。件数を2件のまま保つ（3件目を足さない）
 * ことで、否定側（無関係な固定タスクが owned 扱いにならないこと）も
 * 同じテストの中で引き続き確認する。
 */
test('S15 このアプリが起動したタスクが視覚的に区別される', async () => {
  const { window } = launched;

  // ショートカットの取りこぼしを避けるため、シェルが起動しきるまで待つ（S09 と同様の理由）。
  const initialScreen = window.locator('.terminal-pane__container .xterm-screen').first();
  await expect(initialScreen).toContainText(/[$%#>]/, { timeout: 20_000, useInnerText: true });

  await window.locator('.sidebar__tabs button', { hasText: 'タスク' }).click();

  const items = window.locator('.task-list .task-item');
  await expect(items).toHaveCount(2, { timeout: 15_000 });

  // 固定の2件はいずれも ownedByApp ではない状態で表示される
  await expect(window.locator('.task-item--owned')).toHaveCount(0);
  await expect(window.locator('.task-item__badge')).toHaveCount(0);

  // このアプリから claude を実際に起動してみても、固定タスクの表示は
  // owned 扱いに変化しない（false positive が無いことの確認）
  await window.keyboard.press('Meta+Shift+C');
  // Issue #20 PR 10 でタブタイトルの既定が basename(cwd) になったため、
  // 'claude' 固定ではなく起動ディレクトリの basename 'demo-project' が出る
  // （e2e/fixtures/harness.ts の workDir 参照）。
  const claudeTab = window.locator('.tab-bar__title').filter({ hasText: 'demo-project' });
  await expect(claudeTab).toBeVisible();

  await expect(items).toHaveCount(2);
  await expect(window.locator('.task-item--owned')).toHaveCount(0);
  await expect(window.locator('.task-item__badge')).toHaveCount(0);

  // --- ここから肯定側 ---------------------------------------------------
  //
  // 偽 claude が実際に受け取った --session-id を読む。画面はマスクされて
  // いる（`--session-id <session-id>`）ため、ファイルからしか読めない
  // （e2e/fixtures/bin/claude、S09 と同じ手段）。
  const ownedSessionId = readFileSync(
    join(launched.fixturesDir, 'claude-session-id.txt'),
    'utf8',
  ).trim();

  // 固定2件の sessionId のうち demo-project-busy 側だけを、いま実際に
  // このアプリが起動した sessionId に差し替える。件数は2件のまま
  // （3件目を足さない）ので、否定側の「other-project-idle は owned に
  // ならない」という確認もこの後続けて行える。
  const entries = agentEntriesWithStatus(launched, {}).map((entry) =>
    entry.name === 'demo-project-busy' ? { ...entry, sessionId: ownedSessionId } : entry,
  );
  setAgentEntries(launched, entries);

  // 次のポーリングで、このアプリが起動したセッションだけが owned になる。
  const ownedItem = window.locator('.task-item--owned');
  await expect(ownedItem).toHaveCount(1, { timeout: 15_000 });
  await expect(ownedItem.locator('.task-item__name')).toContainText('demo-project-busy');
  await expect(ownedItem.locator('.task-item__badge')).toHaveText('このアプリ');

  // canFocus（対応するタブが実在する）も満たすので、行は押せる <button> になる。
  const ownedRow = ownedItem.locator('.task-item__row');
  expect(await ownedRow.evaluate((el) => el.tagName)).toBe('BUTTON');

  // 否定側は引き続き成立する: 無関係な other-project-idle は owned のまま扱われない。
  const otherItem = window.locator('.task-item:not(.task-item--owned)');
  await expect(otherItem).toHaveCount(1);
  await expect(otherItem.locator('.task-item__name')).toContainText('other-project-idle');
  await expect(otherItem.locator('.task-item__badge')).toHaveCount(0);
  expect(await otherItem.locator('.task-item__row').evaluate((el) => el.tagName)).toBe('DIV');
});
