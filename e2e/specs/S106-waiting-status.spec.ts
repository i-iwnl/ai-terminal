import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { test, expect } from '@playwright/test';
import { launchApp, closeApp, setAgentEntries, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  // 押せる行（<button aria-label>）も作るので tmux 経路を有効にする（S104 と同じ手口）。
  launched = await launchApp({ config: { useTmux: true }, fakeTmux: true });
});

test.afterEach(async () => {
  await closeApp(launched);
});

/**
 * Issue #241 周2。**`claude agents --json` が返し始めた `status: "waiting"` の扱い。**
 *
 * この spec が無いと、`waiting` に関する経路は**関門を1本も通らない**。
 * 既定フィクスチャ（`harness.ts` の `defaultAgentEntries`）は `busy` / `idle` の2件だけで、
 * `e2e/` 配下に `waiting` は1件も無かった。`toTaskState` を書き換えても E2E は全部緑のまま、
 * `docs/images/` も1画素も動かない。**#241 の原因（判定を誰も実行していなかった）と同じ穴。**
 *
 * ⛔ **既定フィクスチャを書き換えて `waiting` を足さないこと。** `harness.ts` に
 * 「ここを変えると既存シナリオが軒並み動く」と明記されているとおり、実測で E2E 7箇所 +
 * README 画像8枚が動く。**起動後に `setAgentEntries()` で差し替える**（S12 と同じ手口）。
 *
 * ⭐ **`waitingFor` は視覚と読み上げの両方で見る。** 押せる行は `<button aria-label>` で
 * 子要素のテキストが上書きされ、押せない行は `<div>`（名前が付かない）で `aria-label` を
 * 持たない。**片方だけ実装すると、行が押せるかどうかで届いたり届かなかったりする**
 * （実際に「読み上げにだけ足す」実装をこの spec が捕まえた）。
 */

const WAITING_PID = 5001;
const IDLE_PID = 5002;

/** `waiting` 1件 + `idle` 1件。「あなたの番」に2種類が混ざった状態を作る。 */
function entriesWithWaiting(workDir: string, waitingSessionId: string, waitingFor: string) {
  const now = Date.now();
  return [
    {
      pid: WAITING_PID,
      cwd: workDir,
      kind: 'interactive',
      startedAt: now - (3 * 60 * 60_000 + 15 * 60_000 + 30_000),
      sessionId: waitingSessionId,
      name: 'demo-project-waiting',
      status: 'waiting',
      waitingFor,
    },
    {
      pid: IDLE_PID,
      cwd: '/tmp/other-project',
      kind: 'interactive',
      startedAt: now - (1 * 60 * 60_000 + 45 * 60_000 + 30_000),
      sessionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      name: 'other-project-idle',
      status: 'idle',
    },
  ];
}

test('S106 許可待ちのセッションが「あなたの番」として扱われ、何を待っているかが読み上げに出る', async () => {
  const { window, app, workDir, fixturesDir } = launched;

  await expect(window.locator('.terminal-pane__container .xterm-screen').first()).toContainText(
    /[$%#>]/,
    { timeout: 20_000 },
  );
  await window.locator('.sidebar__tabs button', { hasText: 'タスク' }).click();
  await expect(window.locator('.task-list .task-item')).toHaveCount(2, { timeout: 20_000 });

  // --- 否定側を先に見る -----------------------------------------------------
  // 既定フィクスチャ（busy / idle）では「不明」が1件も無いこと。これが無いと、
  // あとで「不明が0件」を見ても、もともと0件だったのか翻訳が効いたのか区別が付かない。
  await expect(window.locator('.task-item--unknown')).toHaveCount(0);
  await expect(window.locator('.task-item--your-turn')).toHaveCount(1);
  await expect(window.locator('.task-item__waiting-for')).toHaveCount(0);

  // --- 押せる行にするため、claude タブを開いてアプリ採番の ID を知る -----------
  // 画面ではなくファイルから読む（偽 CLI は生の UUID を画面に出さない）。S104 と同じ。
  await window.keyboard.press('Meta+Shift+C');
  await expect(window.locator('.tab-bar__tab--claude')).toHaveCount(1, { timeout: 20_000 });
  const sessionName = readFileSync(join(fixturesDir, 'tmux-session-name.txt'), 'utf8').trim();
  const waitingSessionId = sessionName.slice('aiterm-'.length);

  // --- waiting を注入する ---------------------------------------------------
  setAgentEntries(launched, entriesWithWaiting(workDir, waitingSessionId, 'permission prompt'));

  const waitingRow = window.locator('.task-item', { hasText: 'demo-project-waiting' });
  await expect(waitingRow).toHaveCount(1, { timeout: 20_000 });

  // 1. 「不明」ではなく「あなたの番」に入ること。
  //    ⭐ `toTaskState` に `waiting` を足す前は、ここが「不明 1件」で赤くなる。
  await expect(window.locator('.task-item--unknown')).toHaveCount(0);
  await expect(waitingRow).toHaveClass(/task-item--your-turn/);
  await expect(waitingRow.locator('.task-item__state')).toHaveText('あなたの番');
  await expect(window.locator('.task-group__heading', { hasText: 'あなたの番' })).toHaveText(
    'あなたの番 2件',
  );
  await expect(window.locator('.task-group__heading', { hasText: '不明' })).toHaveCount(0);

  // 2. CLI が返した生の値は消さない（鉄則4/5）。
  //    翻訳で潰すと、CLI 側の仕様変更に気づく手がかりが画面から消える。
  await expect(waitingRow.locator('.task-item__raw-status')).toHaveText('waiting');

  // 3-a. 視覚に出ていること。語は4〜5文字に揃えてある。
  //      ⛔ macOS の権限（通知・アクセシビリティの許可）と誤読される「許可待ち」単独にしない。
  await expect(waitingRow.locator('.task-item__waiting-for')).toHaveText('実行許可待ち');

  // 3-b. 読み上げにも届いていること。**この行は押せる**（タブが開いている）ので
  //      `<button aria-label>` になり、子要素のテキストは支援技術に届かない。
  //      前提が崩れると以下が恒真になるので、押せることを先に assert する。
  await expect(waitingRow.locator('button.task-item__row')).toHaveCount(1, { timeout: 20_000 });
  const label = await waitingRow.locator('button.task-item__row').getAttribute('aria-label');
  expect(label).toContain('実行許可待ち');
  expect(label).toContain('demo-project-waiting');
  expect(label).toContain('CLI の生の状態は waiting');

  // 待っていない側（idle）には理由が付かない。
  await expect(
    window.locator('.task-item', { hasText: 'other-project-idle' }).locator('.task-item__waiting-for'),
  ).toHaveCount(0);

  // 4. Dock バッジに数えられること。
  //    **クロームのピクセルを1つも使わずに伝えられる唯一の面**（poller.ts）。
  //    ここが 1 のままだと、許可プロンプトで止まったセッションは
  //    アプリを見ていない時間帯に検知手段がゼロになる。
  await expect
    .poll(async () => app.evaluate(({ app: electronApp }) => electronApp.getBadgeCount()), {
      timeout: 20_000,
    })
    .toBe(2);

  // --- 未知の waitingFor は生のまま出す（鉄則5） ----------------------------
  // 実測した3値は claude 2.1.224 時点のもので、CLI の約束ではない。
  // 4つ目が来たときに「不明」で塗り潰すと、手がかりが画面から消える。
  setAgentEntries(launched, entriesWithWaiting(workDir, waitingSessionId, 'brand new reason'));
  await expect(waitingRow.locator('.task-item__waiting-for')).toHaveText('brand new reason', {
    timeout: 20_000,
  });
});
