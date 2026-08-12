import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { launchApp, closeApp, setAgentEntries, type LaunchedApp } from '../fixtures/harness';
import {
  livePanesFile,
  readKilledTmuxSessions,
  waitForNewTmuxSessionName,
} from '../fixtures/tmuxLivePanes';

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
 * （S113 と同じ手口。ネイティブメニューは実際に開くと E2E が固まりうるので開かない）。
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

/** 捕まえたメニューの n 番目の項目を実際にクリックする。 */
async function clickCapturedItem(app: LaunchedApp['app'], index: number): Promise<void> {
  await app.evaluate((_electron, i) => {
    const g = globalThis as unknown as { __lastMenu?: Electron.Menu };
    g.__lastMenu?.items[i]?.click();
  }, index);
}

/**
 * 実機で踏んだ不具合（Issue #244 周6-a の差し戻し）。
 *
 * **「そのセッションのタブが開いている行」（`resolveTaskRowAction` が `'focus'` を
 * 返す行）を一覧の右クリックから終了しても、タブが閉じずに残っていた。**
 *
 * 直す前の実装は、右クリックメニュー「この AI を終了」がどの行にも同じ1つの
 * `AppAction`（`{ type: 'kill-agent-session' }`）を出し、選ぶと必ず
 * `window.api.agents.killSession()`（tmux セッションの終了）だけを呼んでいた。
 * これは tmux セッションにしか繋がっていない行（`'recover'`）には正しいが、
 * **タブを開いている行（`'focus'`）では、タブの中の PTY（tmux クライアント）が
 * 死ぬだけで、タブ（ペイン）自体を閉じる呼び出しがどこにも無かった。**
 * 結果、タブは「プロセスは終了しました」の状態のまま画面に残り続けた。
 *
 * `e2e/specs/S113-list-row-terminate-menu.spec.ts` は同じ右クリックメニューを
 * 検査しているが、**メニューを開く前に必ずタブを閉じてから**（「AI を残してタブを
 * 閉じる」→ tmux-live-panes.txt で生存させる）行を作っているため、**そこで右クリック
 * する行は常に `'recover'` 状態で、`'focus'` の経路を一度も踏んでいない。**
 * `S116`（メニューバー版）も対象を「タブに戻せる AI」節（`'recover'`）から作っており
 * 同様に `'focus'` を踏まない。これが実機まで漏れた理由そのもの
 * （`'focus'` の経路に E2E の関門が1本も無かった）。
 *
 * ⭐ **この spec が見ているのは4つ。**
 *
 * 1. **否定側を先に見る**: タブを1枚も開いていない「タブに戻せる AI」（`'recover'`）の
 *    行を右クリックすると、ラベルはこれまでどおり「この AI を終了」で、
 *    「このペインを閉じて AI を終了」は出ない。終了してもタブは1枚も閉じない
 *    （閉じるべきタブがそもそも無い。誤ってペインを閉じようとして落ちない、まで見る）
 * 2. **肯定側**: タブを開いている行（`'focus'`）を右クリックすると、ラベルは
 *    「このペインを閉じて AI を終了」になっている（「この AI を終了」ではない）。
 *    行き先が2つに分かれる操作は文言で言い切る（design-rules §6）
 * 3. **肯定側の本体**: それを選ぶと、そのペイン（タブ）が実際に閉じる。
 *    ⭐ **これが直す前は赤くなる部分そのもの**
 * 4. **tmux セッションも同じ操作で終了しており、しかも1回しか叩かれていないこと**
 *    （`agentSessionKill` とペインを閉じる経路の両方を呼ぶと二重になる。
 *    `ptyKill(terminateSession: true)` 側が既に tmux セッションを終了させる）
 */
test('S118 タブが開いている行を一覧から終了すると、ペインごと閉じる', async () => {
  launched = await launchApp({ config: { useTmux: true }, fakeTmux: true });
  const { window, fixturesDir, workDir } = launched;

  // 最初のシェルのプロンプトが出るまで待つ（S104 / S113 と同じ理由）。
  await expect(window.locator('.terminal-pane__container .xterm-screen').first()).toContainText(
    /[$%#>]/,
    { timeout: 20_000 },
  );
  // このあとの「タブは1枚も閉じない」判定の基準にする（シェルタブ1枚）。
  await expect(window.locator('.tab-bar__tab')).toHaveCount(1, { timeout: 20_000 });

  // --- 1. 否定側: タブを一度も開いていない「タブに戻せる AI」（'recover'）の行 ------
  //
  // S116 と同じ手口: `claude agents --json` 側には出さず、tmux-live-panes.txt
  // だけで生存させる。この行に対応するタブはアプリ内に一度も存在しない。
  const recoverSessionName = 'aiterm-55555555-5555-4555-8555-555555555555';
  writeFileSync(
    join(fixturesDir, 'tmux-live-panes.txt'),
    livePanesFile([
      { sessionName: recoverSessionName, startCommand: 'claude --session-id 55555555', cwd: workDir },
    ]),
  );

  const recoverSection = window.locator('.task-group', { hasText: 'タブに戻せる AI' });
  await expect(recoverSection).toHaveCount(1, { timeout: 20_000 });
  const recoverRow = recoverSection.locator('button.task-item__row');
  await expect(recoverRow).toHaveCount(1, { timeout: 20_000 });

  await installMenuSpy(launched.app);
  expect(await lastPoppedItems(launched.app)).toBeNull();

  await recoverRow.click({ button: 'right' });
  await expect
    .poll(async () => (await lastPoppedItems(launched.app))?.length ?? 0, { timeout: 10_000 })
    .toBeGreaterThan(0);

  const recoverItems = await lastPoppedItems(launched.app);
  if (!recoverItems) throw new Error('タブに戻せる AI の行のメニューを捕まえられなかった');
  const recoverKillIndex = recoverItems.findIndex((i) => i.label === 'この AI を終了');
  expect(
    recoverKillIndex,
    `メニューに「この AI を終了」が無い（実際の項目: ${recoverItems
      .map((i) => i.label)
      .join(', ')}）`,
  ).toBeGreaterThan(-1);
  expect(recoverItems.some((i) => i.label === 'このペインを閉じて AI を終了')).toBe(false);

  expect(readKilledTmuxSessions(fixturesDir)).not.toContain(recoverSessionName);

  await clickCapturedItem(launched.app, recoverKillIndex);

  await expect
    .poll(() => readKilledTmuxSessions(fixturesDir), {
      timeout: 15_000,
      message: 'アプリが tmux kill-session を叩いていない（recover 側）',
    })
    .toContain(recoverSessionName);

  // 閉じるべきタブがそもそも無いので、シェルタブ1枚のまま何も変わらない。
  await expect(window.locator('.tab-bar__tab')).toHaveCount(1);

  // --- 2. claude タブを開いたまま、その行を作る（'focus' 状態） -------------------
  await window.keyboard.press('Meta+Shift+C');
  await expect(window.locator('.tab-bar__tab--claude')).toHaveCount(1, { timeout: 15_000 });

  const sessionName = await waitForNewTmuxSessionName(fixturesDir, '');
  const sessionId = sessionName.slice('aiterm-'.length);

  setAgentEntries(launched, [
    {
      pid: 6666,
      cwd: launched.workDir,
      kind: 'interactive',
      startedAt: Date.now() - 60_000,
      sessionId,
      name: 'focus-target',
      status: 'idle',
    },
  ]);

  const row = window.locator('.task-item', { hasText: 'focus-target' });
  await expect(row).toHaveCount(1, { timeout: 20_000 });
  // タブが開いている間は「移動」で押せる（'focus'）。
  const clickableRow = row.locator('button.task-item__row');
  await expect(clickableRow).toHaveCount(1, { timeout: 20_000 });

  // --- 3. 肯定側: ラベルが「このペインを閉じて AI を終了」になっている ------------
  await clickableRow.click({ button: 'right' });
  await expect
    .poll(async () => (await lastPoppedItems(launched.app))?.length ?? 0, { timeout: 10_000 })
    .toBeGreaterThan(0);

  const items = await lastPoppedItems(launched.app);
  if (!items) throw new Error('タブが開いている行のメニューを捕まえられなかった');
  const closeIndex = items.findIndex((i) => i.label === 'このペインを閉じて AI を終了');
  expect(
    closeIndex,
    `メニューに「このペインを閉じて AI を終了」が無い（実際の項目: ${items
      .map((i) => i.label)
      .join(', ')}）`,
  ).toBeGreaterThan(-1);
  expect(items.some((i) => i.label === 'この AI を終了')).toBe(false);

  expect(readKilledTmuxSessions(fixturesDir)).not.toContain(sessionName);

  // --- 4. 肯定側の本体: 選ぶと、そのペイン（タブ）が実際に閉じる ------------------
  // ⭐ 直す前はここが赤くなる（タブが閉じない）。
  await clickCapturedItem(launched.app, closeIndex);
  await expect(window.locator('.tab-bar__tab--claude')).toHaveCount(0, { timeout: 15_000 });

  // --- 5. tmux セッションも終了しており、二重に呼んでいないこと -------------------
  await expect
    .poll(() => readKilledTmuxSessions(fixturesDir), {
      timeout: 15_000,
      message: 'アプリが tmux kill-session を叩いていない（focus 側）',
    })
    .toContain(sessionName);

  const killedCount = readKilledTmuxSessions(fixturesDir)
    .split('\n')
    .filter((line) => line === sessionName).length;
  expect(killedCount, 'agent-session:kill とペインを閉じる経路の両方から二重に呼ばれている').toBe(
    1,
  );
});
