import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { launchApp, closeApp, setAgentEntries, type LaunchedApp } from '../fixtures/harness';
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
 * （S91 / S113 と同じ手口）。
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

/**
 * これまでに popup しようとした**回数**（メニューの項目数ではない）。
 *
 * ⛔ **「新しいメニューが出たこと」を `lastPoppedItems()?.length` で見ないこと。**
 * あれが返すのは**直近のメニューの項目数**で、`taskContextMenuItems()` は行によらず
 * 常に1項目しか返さないので**構造的に 1 から動かない**。かといって
 * `toBeGreaterThan(0)` に緩めると、**1つ前の行で出したメニューの記録が残っている**ので
 * 「2行目の右クリックでメニューが出なくても緑」になる（恒真化）。
 * **2行目以降を見る検査は、必ず累積回数の増加で待つ。**
 */
async function poppedCount(app: LaunchedApp['app']): Promise<number> {
  return app.evaluate(() => {
    const g = globalThis as unknown as { __popped?: unknown[] };
    return (g.__popped ?? []).length;
  });
}

/** 捕まえたメニューの n 番目の項目を実際にクリックする。 */
async function clickCapturedItem(app: LaunchedApp['app'], index: number): Promise<void> {
  await app.evaluate((_electron, i) => {
    const g = globalThis as unknown as { __lastMenu?: Electron.Menu };
    g.__lastMenu?.items[i]?.click();
  }, index);
}

/** 捕まえたメニューから、指定ラベルの項目 index を探す（無ければ -1）。 */
function findItemIndex(items: CapturedItem[], label: string): number {
  return items.findIndex((i) => i.label === label);
}

/**
 * #244 周6-a。**一覧の行から終了するときも、作業中だけは確認が要る。**
 *
 * S111 が確立した「作業中の AI を閉じるときだけ確認する」という安全弁
 * （iTerm2 / Terminal.app / Ghostty / tmux が全て備える設計）を、
 * タブを開いている場合の `Cmd+W` 経路だけでなく、周6-a で新設する
 * 一覧の右クリック終了（S113）にも同じ強さで適用する。
 *
 * ⭐ **否定側と肯定側を同じ spec で見る。** 同じ形の行を `idle` / `busy` の
 * 2つ用意し、状態だけを変えて2回測る。**「常に確認する」実装も
 * 「一度も確認しない」実装も、片方だけを見る spec では落とせない。**
 *
 * - **否定側**: `idle` の行 -> 右クリック -> 「この AI を終了」-> 確認は出ず、
 *   即座に `tmux kill-session` が叩かれる
 * - **肯定側**: `busy` の行 -> 同じ操作 -> `role="alertdialog"` が出る。
 *   本文に「作業中」と「やり直しになります」を含む（S111 と同じ文言の要件。
 *   「取り消せます」とは言えない = 何が戻らないかを言う）。実行して初めて叩かれる
 *
 * ⭐ **2つの行は最初から tmux に生きている状態で用意する**（S104 / S113 のように
 * 実際にタブを開いて閉じ直す手順を踏まない）。`resolveAppSessionIds` の一致条件は
 * `task.sessionId` と tmux セッション名から取れる `agentSessionId` の**直接一致**
 * （`sessionMatch.ts` の 1 段目）なので、`aiterm-<sessionId>` の形さえ守れば
 * 実際に claude を起動しなくても「タブに戻せる（押せる）」行を作れる。
 */
test('S114 作業中の AI を一覧から終了するときだけ確認が出る', async () => {
  launched = await launchApp({ config: { useTmux: true }, fakeTmux: true });
  const { window, fixturesDir, workDir } = launched;

  const dialog = window.locator('[role="alertdialog"]');

  await expect(window.locator('.terminal-pane__container .xterm-screen').first()).toContainText(
    /[$%#>]/,
    { timeout: 20_000 },
  );

  const idleId = randomUUID();
  const busyId = randomUUID();
  const idleSessionName = `aiterm-${idleId}`;
  const busySessionName = `aiterm-${busyId}`;

  // 両方とも tmux に生きている状態にする（⛔ 行を手で組み立てない。S104 の注記）。
  writeFileSync(
    join(fixturesDir, 'tmux-live-panes.txt'),
    livePanesFile([
      { sessionName: idleSessionName, startCommand: `claude --session-id ${idleId}`, cwd: workDir },
      { sessionName: busySessionName, startCommand: `claude --session-id ${busyId}`, cwd: workDir },
    ]),
  );

  setAgentEntries(launched, [
    {
      pid: 5001,
      cwd: workDir,
      kind: 'interactive',
      startedAt: Date.now() - 60_000,
      sessionId: idleId,
      name: 'idle-target',
      status: 'idle',
    },
    {
      pid: 5002,
      cwd: workDir,
      kind: 'interactive',
      startedAt: Date.now() - 60_000,
      sessionId: busyId,
      name: 'busy-target',
      status: 'busy',
    },
  ]);

  const idleRow = window.locator('.task-item', { hasText: 'idle-target' });
  const busyRow = window.locator('.task-item', { hasText: 'busy-target' });
  const idleButton = idleRow.locator('button.task-item__row');
  const busyButton = busyRow.locator('button.task-item__row');

  await expect(idleButton).toHaveCount(1, { timeout: 20_000 });
  await expect(busyButton).toHaveCount(1, { timeout: 20_000 });
  // 画面上でも「作業中」として扱われていることを確かめてから操作する
  // （S111 と同じ理由。反映前に押すと「たまたま確認が出なかった」を見逃す）。
  await expect(window.locator('.task-item--working', { hasText: 'busy-target' })).toHaveCount(1, {
    timeout: 20_000,
  });

  await installMenuSpy(launched.app);
  expect(await lastPoppedItems(launched.app)).toBeNull();

  // --- 否定側: idle は確認なしで即座に終了する ------------------------------------
  await idleButton.click({ button: 'right' });
  await expect
    .poll(async () => (await lastPoppedItems(launched.app))?.length ?? 0, { timeout: 10_000 })
    .toBeGreaterThan(0);

  const idleItems = await lastPoppedItems(launched.app);
  if (!idleItems) throw new Error('idle 行のメニューを捕まえられなかった');
  const idleKillIndex = findItemIndex(idleItems, 'この AI を終了');
  expect(
    idleKillIndex,
    `idle 行のメニューに「この AI を終了」が無い（実際の項目: ${idleItems.map((i) => i.label).join(', ')}）`,
  ).toBeGreaterThan(-1);

  await clickCapturedItem(launched.app, idleKillIndex);

  // 確認ダイアログは出ない。
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() => readKilledTmuxSessions(fixturesDir), {
      timeout: 15_000,
      message: 'idle 行の tmux kill-session が呼ばれていない',
    })
    .toContain(idleSessionName);

  // --- 肯定側: busy は確認が出てから終了する --------------------------------------
  expect(readKilledTmuxSessions(fixturesDir), 'busy 行が先に終了させられている').not.toContain(
    busySessionName,
  );

  // ⭐ **累積回数の増加で待つ**（理由は poppedCount() の doc）。
  // idle 行で1回出しているので、ここは「2回目が出たこと」を見る。
  const poppedBeforeBusy = await poppedCount(launched.app);
  await busyButton.click({ button: 'right' });
  await expect
    .poll(() => poppedCount(launched.app), {
      timeout: 10_000,
      message: 'busy 行を右クリックしても新しいメニューが出ていない',
    })
    .toBeGreaterThan(poppedBeforeBusy);

  const busyItems = await lastPoppedItems(launched.app);
  if (!busyItems) throw new Error('busy 行のメニューを捕まえられなかった');
  const busyKillIndex = findItemIndex(busyItems, 'この AI を終了');
  expect(
    busyKillIndex,
    `busy 行のメニューに「この AI を終了」が無い（実際の項目: ${busyItems.map((i) => i.label).join(', ')}）`,
  ).toBeGreaterThan(-1);

  await clickCapturedItem(launched.app, busyKillIndex);

  await expect(dialog).toBeVisible({ timeout: 10_000 });
  // ⭐ 何が戻らないかを言う（S111 と同じ要件）。「取り消せます」とは言えない。
  await expect(dialog).toContainText('作業中');
  await expect(dialog).toContainText('やり直しになります');
  // まだ終了させていない（確認が形だけになっていないこと）。
  expect(readKilledTmuxSessions(fixturesDir)).not.toContain(busySessionName);

  // 実行する。破壊的操作のボタンは `.confirm-dialog__button--danger`
  // （`CloseTabConfirmDialog.tsx` の既存の作法。S62 / S90 / S111 と同じ確認ダイアログの実装を
  // 再利用する前提。もし新しいダイアログ実装を起こす場合は、このクラスに合わせること）。
  await dialog.locator('.confirm-dialog__button--danger').click();
  await expect(dialog).toHaveCount(0);

  await expect
    .poll(() => readKilledTmuxSessions(fixturesDir), {
      timeout: 15_000,
      message: 'busy 行の tmux kill-session が呼ばれていない',
    })
    .toContain(busySessionName);
});
