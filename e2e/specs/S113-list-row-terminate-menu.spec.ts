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
 * （S91 と同じ手口。ネイティブメニューは実際に開くと E2E が固まりうるので開かない）。
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

/** アプリケーションメニューの項目をラベルで探して押す（S104 / S107 と同じ手口）。 */
async function clickMenuItem(app: LaunchedApp['app'], label: string): Promise<boolean> {
  return app.evaluate(({ Menu }, target) => {
    const menu = Menu.getApplicationMenu();
    if (!menu) return false;
    let found: Electron.MenuItem | undefined;
    const walk = (items: Electron.MenuItem[]): void => {
      for (const item of items) {
        if (item.label === target) found = item;
        if (item.submenu) walk(item.submenu.items);
      }
    };
    walk(menu.items);
    if (!found?.click || !found.enabled) return false;
    found.click();
    return true;
  }, label);
}

/**
 * #244 周6-a。**タスク一覧の行を、タブを開かずに右クリックで終了できる。**
 *
 * 周1〜5 で「タブを閉じる = AI を終了する」に変えたが、その導線は**タブを開いている
 * ときだけ**しか無い。タブに戻せる（`recoverable`）だけの行には終了する手段が
 * 1つも無く、`tmux kill-session` を直接叩く以外に累積を止められなかった。
 *
 * 導線は S91（ターミナル面の右クリック）と同じ**ネイティブメニュー**
 * （`Menu.prototype.popup` を差し替えて中身を捕まえる。実際には開かない）。
 *
 * ⭐ **この spec が見ているのは2つ。**
 *
 * 1. **肯定側**: 押せる行（`button.task-item__row`）を右クリックすると、
 *    「この AI を終了」を含むメニューが出て、選ぶと `tmux kill-session` が
 *    実際に叩かれる（偽 tmux の `tmux-killed-sessions.txt` に記録される）
 * 2. **否定側**: 押せない行（`div.task-item__row`）を右クリックしても
 *    メニューは出ない。終了できる対象（生きている tmux セッション）が
 *    そもそも無いので、出すこと自体が誤りになる
 *
 * **否定側が無いと「全行でメニューを出す」実装でも緑になる。** 逆に肯定側が
 * 無いと「一度もメニューを出さない」実装でも否定側だけは緑になってしまう。
 *
 * ⛔ **`Cmd+W` を使わない。** #244 で意味が変わり、タブを閉じるだけで
 * tmux セッションごと終了するため、「閉じたが tmux には生きている」という
 * この spec の前提を作れない（S104 の同じ注記を参照）。
 * 「AI を残してタブを閉じる」でタブを閉じ、`tmux-live-panes.txt` を書いて
 * 初めて「タブは無いが tmux には生きている」= 押せない行から押せる行への
 * 遷移を作る（S104 と同じ手順）。
 *
 * ⚠ **このシムで担保できないこと**: 偽 tmux は `kill-session` を受けたことと
 * その名前を記録するだけで、本物の `claude` プロセスが実際に終了するかは
 * 再現しない（`e2e/fixtures/bin/tmux` 冒頭）。「本当にプロセスが死ぬ」は実機確認。
 */
test('S113 一覧の行を右クリックして AI を終了できる', async () => {
  launched = await launchApp({ config: { useTmux: true }, fakeTmux: true });
  const { window, fixturesDir } = launched;

  // 最初のシェルのプロンプトが出るまで待ってから操作する（S104 と同じ理由）。
  await expect(window.locator('.terminal-pane__container .xterm-screen').first()).toContainText(
    /[$%#>]/,
    { timeout: 20_000 },
  );

  // --- 1. claude タブを開き、アプリが採番した tmux セッション名を知る ------------
  await window.keyboard.press('Meta+Shift+C');
  await expect(window.locator('.tab-bar__tab--claude')).toHaveCount(1, { timeout: 15_000 });

  const sessionName = await waitForNewTmuxSessionName(fixturesDir, '');
  const sessionId = sessionName.slice('aiterm-'.length);

  // そのセッションが `claude agents --json` にも出ている状態にする（一覧に行が立つ）。
  setAgentEntries(launched, [
    {
      pid: 4321,
      cwd: launched.workDir,
      kind: 'interactive',
      startedAt: Date.now() - 60_000,
      sessionId,
      name: 'kill-target',
      status: 'idle',
    },
  ]);

  const row = window.locator('.task-item', { hasText: 'kill-target' });
  await expect(row).toHaveCount(1, { timeout: 20_000 });

  await installMenuSpy(launched.app);
  // スパイを張った直後は、まだ1度も popup していないこと。
  expect(await lastPoppedItems(launched.app)).toBeNull();

  // --- 2. 「AI を残して」閉じる。この時点ではまだ tmux に「生きている」記録が無い -
  expect(await clickMenuItem(launched.app, 'AI を残してタブを閉じる')).toBe(true);
  await expect(window.locator('.tab-bar__tab--claude')).toHaveCount(0, { timeout: 15_000 });

  // --- 3. 否定側: 押せない行（div）を右クリックしてもメニューが出ない -------------
  const notClickableRow = row.locator('div.task-item__row');
  await expect(notClickableRow).toHaveCount(1, { timeout: 20_000 });
  await expect(row.locator('button.task-item__row')).toHaveCount(0);

  await notClickableRow.click({ button: 'right' });
  // 「出ない」ことの証明は「待っても起きない」でしか言えない（S93 と同じ形）。
  await window.waitForTimeout(1_000);
  expect(
    await lastPoppedItems(launched.app),
    '押せない行を右クリックしただけでメニューが出ている',
  ).toBeNull();

  // --- 4. tmux に生きている状態を作ると、押せる行になる（S104 と同じ手順） --------
  writeFileSync(
    join(fixturesDir, 'tmux-live-panes.txt'),
    livePanesFile([
      { sessionName, startCommand: `claude --session-id ${sessionId}`, cwd: launched.workDir },
    ]),
  );

  const clickableRow = row.locator('button.task-item__row');
  await expect(clickableRow).toHaveCount(1, { timeout: 20_000 });

  // まだ何も終了させていない（否定側の前提が壊れていないことの再確認）。
  expect(readKilledTmuxSessions(fixturesDir)).not.toContain(sessionName);

  // --- 5. 肯定側: 押せる行を右クリックすると「この AI を終了」が出て、選べる ------
  await clickableRow.click({ button: 'right' });

  await expect
    .poll(async () => (await lastPoppedItems(launched.app))?.length ?? 0, { timeout: 10_000 })
    .toBeGreaterThan(0);

  const items = await lastPoppedItems(launched.app);
  if (!items) throw new Error('押せる行のメニューを捕まえられなかった');
  const killIndex = items.findIndex((i) => i.label === 'この AI を終了');
  expect(
    killIndex,
    `メニューに「この AI を終了」が無い（実際の項目: ${items.map((i) => i.label).join(', ')}）`,
  ).toBeGreaterThan(-1);

  await clickCapturedItem(launched.app, killIndex);

  // --- 6. tmux kill-session が実際に叩かれた -------------------------------------
  await expect
    .poll(() => readKilledTmuxSessions(fixturesDir), {
      timeout: 15_000,
      message: 'アプリが tmux kill-session を叩いていない',
    })
    .toContain(sessionName);
});
