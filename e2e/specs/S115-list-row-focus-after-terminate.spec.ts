import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';
import { livePanesFile, readKilledTmuxSessions } from '../fixtures/tmuxLivePanes';

let launched: LaunchedApp;

test.afterEach(async () => {
  await closeApp(launched);
});

interface CapturedItem {
  label: string;
  type: string;
  role: string | null;
  enabled: boolean;
}

/**
 * `Menu.prototype.popup` を差し替えて、出そうとしたメニューの中身を捕まえる
 * （S91 / S113 / S114 と同じ手口）。
 */
async function installMenuSpy(app: LaunchedApp['app']): Promise<void> {
  await app.evaluate(({ Menu }) => {
    const g = globalThis as unknown as { __popped?: unknown[]; __lastMenu?: unknown };
    g.__popped = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Menu.prototype as any).popup = function (this: Electron.Menu) {
      g.__lastMenu = this;
      (g.__popped as unknown[]).push(
        this.items.map((i) => ({
          label: i.label,
          type: i.type,
          role: i.role ?? null,
          enabled: i.enabled,
        })),
      );
    };
  });
}

/** 直近に popup しようとしたメニューの項目（まだ1度も popup していなければ null）。 */
async function lastPoppedItems(app: LaunchedApp['app']): Promise<CapturedItem[] | null> {
  return app.evaluate(() => {
    const g = globalThis as unknown as { __popped?: CapturedItem[][] };
    const all = g.__popped ?? [];
    return all.length === 0 ? null : all[all.length - 1];
  });
}

/** 捕まえたメニューの中から、指定ラベルの項目を実際にクリックする。 */
async function clickCapturedItemByLabel(app: LaunchedApp['app'], label: string): Promise<void> {
  const items = await lastPoppedItems(app);
  if (!items) throw new Error('メニューを捕まえられなかった');
  const index = items.findIndex((i) => i.label === label);
  expect(index, `メニューに「${label}」が無い（実際の項目: ${items.map((i) => i.label).join(', ')}）`).toBeGreaterThan(-1);
  await app.evaluate((_electron, i) => {
    const g = globalThis as unknown as { __lastMenu?: Electron.Menu };
    g.__lastMenu?.items[i]?.click();
  }, index);
}

/**
 * #244 周6-a 差し戻し分。**行から AI を終了したあと、フォーカスが正しい次の場所へ移る。**
 *
 * 実機（agent-browser + CDP、本物の tmux）で発見された欠陥の再現:
 * 「タブに戻せる AI」節に2行あるとき、1行目にフォーカスを当ててからその行を終了すると、
 * 行は正しく消える（残り1行になる）のに、**フォーカスが2行目へ移らず `<body>` に落ちる**。
 * 終了に成功すると DOM から消えるのはフォーカス中の要素そのものなので、明示的に
 * 次のフォーカス先へ移す実装（TaskList.tsx）が無いと毎回この壊れ方をする。
 *
 * ⭐ **2つのケースを同じ spec で見る**（1 spec = 1 test の原則。check7）。
 *
 * 1. **節に行が残る場合**: 2行 -> 1行目を終了 -> フォーカスは同じ節の残り1行
 *    （`button.task-item__row`）へ移る
 * 2. **節が空になる場合**: 残り1行も終了 -> 節そのもの（見出し込み）が消える
 *    （`recoverable.length > 0` の条件レンダリング。`.task-group__heading` は
 *    最後の1行と同時に DOM から消えるので、この場合の逃がし先には**なれない**）。
 *    パネル見出し（`<h2 className="panel-scope">`。常に描画されており節の状態に
 *    依存しない）へ最終フォールバックする。
 *
 * どちらも **`<body>` に落ちてはいけない**（WCAG 2.4.3 フォーカス順序。
 * `.claude/workspace/issue-244/design-review/proposal-v2-after-review.md` §4-4 が
 * 警告していた事象）。
 *
 * ⛔ 行を手で `join('\x1f')` しないこと（理由は `e2e/fixtures/tmuxLivePanes.ts` 冒頭）。
 */
test('S115 一覧の行を終了すると、フォーカスが次の行 -> パネル見出しの順に移る', async () => {
  launched = await launchApp({ config: { useTmux: true }, fakeTmux: true });
  const { window, fixturesDir, workDir } = launched;

  await expect(window.locator('.terminal-pane__container .xterm-screen').first()).toContainText(
    /[$%#>]/,
    { timeout: 20_000 },
  );

  const sessionA = 'aiterm-11111111-1111-4111-8111-111111111111';
  const sessionB = 'aiterm-22222222-2222-4222-8222-222222222222';

  // 「タブに戻せる AI」節に2行を作る（claude agents --json には出ない、tmux だけの
  // セッション。S105 と同じ手口）。
  writeFileSync(
    join(fixturesDir, 'tmux-live-panes.txt'),
    livePanesFile([
      { sessionName: sessionA, startCommand: 'claude --session-id 11111111', cwd: workDir },
      { sessionName: sessionB, startCommand: 'claude --session-id 22222222', cwd: workDir },
    ]),
  );

  const section = window.locator('.task-group', { hasText: 'タブに戻せる AI' });
  await expect(section).toHaveCount(1, { timeout: 20_000 });
  const rows = section.locator('button.task-item__row');
  await expect(rows).toHaveCount(2, { timeout: 20_000 });

  // ⛔ `rows.nth(0)` / `rows.nth(1)` のような**index ベース**の参照にしないこと。
  // 1行目を消したあとは残り行が index 0 に繰り上がるので、消える前に取った
  // `nth(1)` は「もう存在しない2番目」を指したまま永遠に見つからなくなる
  // （実際にこれで落ちた: `Locator ... nth(1)` が `element(s) not found`）。
  // 表示名（`liveSessionDisplayName` = `セッション <uuid先頭8桁>`）で個体を
  // 直接指し、行の増減に依存しない安定した参照にする。
  const rowA = section
    .locator('.task-item', { hasText: 'セッション 11111111' })
    .locator('button.task-item__row');
  const rowB = section
    .locator('.task-item', { hasText: 'セッション 22222222' })
    .locator('button.task-item__row');

  // --- 1. 1行目にフォーカスを当ててから終了する -----------------------------------
  await rowA.focus();
  await expect(rowA).toBeFocused();

  await installMenuSpy(launched.app);
  await rowA.click({ button: 'right' });
  await expect
    .poll(async () => (await lastPoppedItems(launched.app))?.length ?? 0, { timeout: 10_000 })
    .toBeGreaterThan(0);
  await clickCapturedItemByLabel(launched.app, 'この AI を終了');

  await expect
    .poll(() => readKilledTmuxSessions(fixturesDir), {
      timeout: 15_000,
      message: '1行目の tmux kill-session が呼ばれていない',
    })
    .toContain(sessionA);

  // 行が実際に1件になるまで待つ（ポーリングで消えるため即座ではない）。
  await expect(rows).toHaveCount(1, { timeout: 20_000 });

  // ⭐ 本体: フォーカスが <body> に落ちず、残った行（元の2行目 = rowB）に移っていること。
  await expect(rowB).toBeFocused({ timeout: 20_000 });

  // --- 2. 残り1行（節の最後の1行）も終了する ---------------------------------------
  await installMenuSpy(launched.app);
  await rowB.click({ button: 'right' });
  await expect
    .poll(async () => (await lastPoppedItems(launched.app))?.length ?? 0, { timeout: 10_000 })
    .toBeGreaterThan(0);
  await clickCapturedItemByLabel(launched.app, 'この AI を終了');

  await expect
    .poll(() => readKilledTmuxSessions(fixturesDir), {
      timeout: 15_000,
      message: '2行目の tmux kill-session が呼ばれていない',
    })
    .toContain(sessionB);

  // 節ごと消える（見出しも一緒に消える。条件レンダリングの前提は本文コメント参照）。
  await expect(section).toHaveCount(0, { timeout: 20_000 });

  // ⭐ 本体: それでも <body> に落ちず、パネル見出し（常に存在する）へ移っていること。
  await expect(window.locator('h2.panel-scope')).toBeFocused({ timeout: 20_000 });
});
