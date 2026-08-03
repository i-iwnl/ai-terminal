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
 * 固定の agents.json は demo-project-busy（status: busy）と other-project-idle（status: idle）の
 * 2件を返す（harness.ts）。**フィクスチャの定義順は busy が先。**
 *
 * CLI の語と、人間から見た意味は逆になる:
 *   busy = エージェントが動いている  -> 人間は待たなくてよい -> task-item--working
 *   idle = エージェントが止まっている -> あなたの番           -> task-item--your-turn
 *
 * このテストの主眼は「2件が区別されること」ではなく、**強調されているのが
 * 「あなたの番」の側であること**。ここが逆転すると、放っておいてよい行だけが
 * 光る状態に戻る（Issue #21）。
 *
 * Issue #20 B（PR 8: タスク行の再設計）の3点もここで確認する:
 * - 状態語は行の左（.task-item__name の先頭）に置く
 * - グループ見出しで区切る（ソートだけでは境界が視覚以外に伝わらない）
 * - 並び順は CLI が返した順ではなく「あなたの番」が先頭
 *
 * Issue #120 D-2（周5）で、**「待たせている時間」（yourTurnSince）の検証を末尾に足した。**
 *
 * それまでは「固定フィクスチャは busy -> idle の遷移が一度も起きないので検証しない」
 * としていた。遷移ロジック自体は `test/unit/your-turn-since.test.ts` が7件固定して
 * いるが、**結合は一度も実行されていなかった**（PR #82 で入れた「待たせています」が
 * E2E からもスクリーンショットからも通っていなかった）。
 *
 * 遷移は**偽 CLI を改造せずに**作る。偽 CLI は呼ばれるたびに `agents.json` を
 * 読み直すので、`setAgentEntries()` でファイルを差し替えれば次のポーリングから
 * 新しい内容になる（`harness.ts` のコメント参照）。
 */
test('S12 実行中タスクが一覧に表示され、状態で区別される', async () => {
  const { window } = launched;

  // サイドバーは既定でタスクタブだが、明示的に切り替えておく
  await window.locator('.sidebar__tabs button', { hasText: 'タスク' }).click();

  const items = window.locator('.task-list .task-item');
  await expect(items).toHaveCount(2, { timeout: 15_000 });

  const yourTurnItem = window.locator('.task-item--your-turn');
  const workingItem = window.locator('.task-item--working');
  await expect(yourTurnItem).toHaveCount(1);
  await expect(workingItem).toHaveCount(1);

  // CLI の status と、アプリ側の意味の対応が逆になっていないこと
  await expect(workingItem.locator('.task-item__name')).toContainText('demo-project-busy');
  await expect(yourTurnItem.locator('.task-item__name')).toContainText('other-project-idle');

  // 状態が日本語の語でも示されていること（色だけに依存しない）
  await expect(yourTurnItem.locator('.task-item__state')).toHaveText('あなたの番');
  await expect(workingItem.locator('.task-item__state')).toHaveText('作業中');

  // CLI が返した生の値も残っていること（鉄則4/5: CLI が言ったことを隠さない）
  await expect(yourTurnItem.locator('.task-item__raw-status')).toHaveText('idle');
  await expect(workingItem.locator('.task-item__raw-status')).toHaveText('busy');

  // 視覚的な区別: status-dot の背景色が異なること
  const yourTurnColor = await yourTurnItem
    .locator('.task-item__status-dot')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  const workingColor = await workingItem
    .locator('.task-item__status-dot')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(yourTurnColor).not.toBe(workingColor);

  // **強調されているのは「あなたの番」の側**であること。
  // グロー（box-shadow）を持つのは your-turn だけで、working は持たない。
  // 色を入れ替えて戻すと、ここが赤くなる。
  const yourTurnShadow = await yourTurnItem
    .locator('.task-item__status-dot')
    .evaluate((el) => getComputedStyle(el).boxShadow);
  const workingShadow = await workingItem
    .locator('.task-item__status-dot')
    .evaluate((el) => getComputedStyle(el).boxShadow);
  expect(yourTurnShadow).not.toBe('none');
  expect(workingShadow).toBe('none');

  // クラス名自体でも区別されていること
  await expect(yourTurnItem).not.toHaveClass(/task-item--working/);
  await expect(workingItem).not.toHaveClass(/task-item--your-turn/);

  // Issue #20 B: 状態語は行の左（.task-item__name の先頭）に置く。
  // 走査は左から右なので、色だけでなく語も真っ先に読めること。
  const yourTurnNameText = await yourTurnItem.locator('.task-item__name').innerText();
  expect(yourTurnNameText.startsWith('あなたの番')).toBe(true);
  const workingNameText = await workingItem.locator('.task-item__name').innerText();
  expect(workingNameText.startsWith('作業中')).toBe(true);

  // グループ見出しで区切られていること。色相の違いは手がかりに数えない、という
  // 原則に従い、色・形（見出しの区切り）・語の3つが独立に同じ情報を運ぶ。
  const headings = window.locator('.task-group__heading');
  await expect(headings).toHaveCount(2);
  await expect(headings.nth(0)).toHaveText('あなたの番 1件');
  await expect(headings.nth(1)).toHaveText('作業中 1件');

  // 並び順: フィクスチャの定義順（busy が先）に関わらず、「あなたの番」の
  // グループが先頭に来ること。CLI が返した順のままだと、あなたの番が
  // 一覧の下に沈んで見落とされる（Issue #20 B）。
  const groupOrder = await window.locator('.task-group').evaluateAll((groups) =>
    groups.map((g) => (g.querySelector('.task-item--your-turn') ? 'your-turn' : 'working')),
  );
  expect(groupOrder).toEqual(['your-turn', 'working']);

  // --- Issue #120 D-2: busy -> idle の遷移で「待たせています」に切り替わる -------
  //
  // ここまでの assert が「遷移前」の状態を固定しているので、遷移はこの後で起こす。
  //
  // **other-project-idle を idle -> busy -> idle と往復させる。**
  // 「demo を idle にする」でも遷移は作れるが、それだと
  // `demo-project-busy` という名前の行が「あなたの番」に出る = **名前と状態が
  // 矛盾した画面**になる（撮影レーンの S12 が同じ手順で README 用の画像を撮るので、
  // 配布物にその矛盾がそのまま載る）。往復なら名前と状態が最後まで一致する。
  //
  // 偽 CLI は改造していない。呼ばれるたびに `agents.json` を読み直すので、
  // ファイルを差し替えれば次のポーリングから新しい内容になる。
  const setStatuses = (statusByName: Record<string, string>): void =>
    setAgentEntries(launched, agentEntriesWithStatus(launched, statusByName));

  // 1) idle 側を busy にする。**ポーラーがこの busy を1周期観測することが要る**
  //    （`poller.ts` は前回の観測と比べて busy -> 非busy を見るので、
  //    観測されないまま idle へ戻すと遷移が起きない）。画面で確認してから次へ進む。
  setStatuses({ 'other-project-idle': 'busy' });
  await expect(window.locator('.task-item--working')).toHaveCount(2, { timeout: 15_000 });

  // 2) 既定（idle）へ戻す。ここで busy -> idle の遷移が観測される。
  setStatuses({});
  await expect(window.locator('.task-item--your-turn')).toHaveCount(1, { timeout: 15_000 });

  // **本題**: 遷移を観測した側だけが「待たせています」になる。
  // 遷移前は startedAt からの通算（`H時間M分`）だったので、文言の形が変わる。
  const yourTurnElapsed = window.locator('.task-item--your-turn .task-item__elapsed');
  await expect(yourTurnElapsed).toContainText('待たせています', { timeout: 15_000 });
  // 名前と状態が矛盾していないこと（撮影レーンが同じ手順で画像を作るため）。
  await expect(window.locator('.task-item--your-turn .task-item__name')).toContainText(
    'other-project-idle',
  );

  // 遷移していない側（ずっと busy）は通算のまま。ここを見ないと
  // 「全部の行が待たせていますになった」壊れ方を見逃す。
  await expect(window.locator('.task-item--working .task-item__elapsed')).not.toContainText(
    '待たせています',
  );
});
