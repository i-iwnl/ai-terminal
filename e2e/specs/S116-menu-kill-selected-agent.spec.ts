import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';
import { livePanesFile, readKilledTmuxSessions } from '../fixtures/tmuxLivePanes';

let launched: LaunchedApp;

test.afterEach(async () => {
  await closeApp(launched);
});

/** アプリケーションメニューの項目をラベルで探して押す（S60 / S104 / S107 と同じ手口）。 */
async function clickMenuItem(app: LaunchedApp['app'], label: string): Promise<boolean> {
  return app.evaluate(({ Menu }, targetLabel) => {
    const menu = Menu.getApplicationMenu();
    if (!menu) return false;
    let target: Electron.MenuItem | undefined;
    const walk = (items: Electron.MenuItem[]): void => {
      for (const item of items) {
        if (item.label === targetLabel) target = item;
        if (item.submenu) walk(item.submenu.items);
      }
    };
    walk(menu.items);
    if (!target?.click || !target.enabled) return false;
    target.click();
    return true;
  }, label);
}

/** アプリケーションメニューの項目をラベルで探して、その enabled を読む（クリックはしない）。 */
async function menuItemEnabled(app: LaunchedApp['app'], label: string): Promise<boolean | null> {
  return app.evaluate(({ Menu }, targetLabel) => {
    const menu = Menu.getApplicationMenu();
    if (!menu) return null;
    let target: Electron.MenuItem | undefined;
    const walk = (items: Electron.MenuItem[]): void => {
      for (const item of items) {
        if (item.label === targetLabel) target = item;
        if (item.submenu) walk(item.submenu.items);
      }
    };
    walk(menu.items);
    return target ? target.enabled : null;
  }, label);
}

/**
 * #244 周6-b。**同じ「この AI を終了」を、右クリックだけでなくメニューバーからも呼べる。**
 *
 * 周6-a で入った右クリック導線（S113）は、design-review の5ペルソナが
 * 「ターゲットサイズ・色覚・タブストップの問題が残るので、メニューバー経由の
 * キーボード経路を必ず用意する」と確定させた項目の片方でしかない。この spec は
 * その残りの半分（ファイル > 選択中の AI を終了）を検査する。
 *
 * ⭐ **この spec が見ているのは3つ。**
 *
 * 1. **否定側**: 一覧の行を1つもフォーカスしていない状態では、メニュー項目
 *    「選択中の AI を終了」が無効（`enabled === false`）
 * 2. **肯定側**: 押せる行をフォーカスすると有効になり、選ぶと `tmux kill-session`
 *    が実際に叩かれる（S113 の右クリックと同じ経路・同じ対象へ効くことの確認）
 * 3. **対象が消えたら無効に戻る**: 終了して行が一覧から消えたあと、メニュー項目は
 *    再び無効に戻る。**これが無いと「一度有効にしたら有効のまま」の実装でも
 *    緑になる**（一覧から消えた対象を指したまま有効に見えてしまう不具合を防ぐ）
 *
 * 対象を作る手口は S115 と同じ（「タブに戻せる AI」節を `tmux-live-panes.txt` で
 * 直接作る。`claude agents --json` 側のフィクスチャは触らないので busy 判定に
 * 掛からず、確認ダイアログなしで即座に終了する）。
 *
 * ⛔ **`Menu.prototype.popup` は差し替えない。** S113/S114/S115 はネイティブの
 * 右クリックメニュー（都度 `popup()` で組み立てる）を見るためにスパイが要るが、
 * こちらはアプリケーションメニュー本体（`Menu.getApplicationMenu()`）が対象で、
 * 実際に開かなくても `MenuItem.enabled` をそのまま読める。
 */
test('S116 メニューの「選択中の AI を終了」で対象を終了でき、対象が消えると無効に戻る', async () => {
  launched = await launchApp({ config: { useTmux: true }, fakeTmux: true });
  const { window, fixturesDir, workDir } = launched;

  await expect(window.locator('.terminal-pane__container .xterm-screen').first()).toContainText(
    /[$%#>]/,
    { timeout: 20_000 },
  );

  // --- 1. 否定側: まだ何もフォーカスしていない。メニュー項目は無効 -----------------
  await expect.poll(() => menuItemEnabled(launched.app, '選択中の AI を終了')).toBe(false);

  // --- 2. 「タブに戻せる AI」節に1行作る（S115 と同じ手口） -----------------------
  const sessionName = 'aiterm-33333333-3333-4333-8333-333333333333';
  writeFileSync(
    join(fixturesDir, 'tmux-live-panes.txt'),
    livePanesFile([{ sessionName, startCommand: 'claude --session-id 33333333', cwd: workDir }]),
  );

  const section = window.locator('.task-group', { hasText: 'タブに戻せる AI' });
  await expect(section).toHaveCount(1, { timeout: 20_000 });
  const row = section.locator('button.task-item__row');
  await expect(row).toHaveCount(1, { timeout: 20_000 });

  // --- 3. 肯定側: 行をフォーカスするとメニュー項目が有効になる -------------------
  await row.focus();
  await expect(row).toBeFocused();
  await expect.poll(() => menuItemEnabled(launched.app, '選択中の AI を終了')).toBe(true);

  // まだ何も終了させていない。
  expect(readKilledTmuxSessions(fixturesDir)).not.toContain(sessionName);

  // --- 4. メニュー項目を選ぶと、右クリックと同じ経路で実際に叩かれる --------------
  expect(await clickMenuItem(launched.app, '選択中の AI を終了')).toBe(true);

  await expect
    .poll(() => readKilledTmuxSessions(fixturesDir), {
      timeout: 15_000,
      message: 'メニューから選んでも tmux kill-session が呼ばれていない',
    })
    .toContain(sessionName);

  // --- 5. 対象が一覧から消えると、メニュー項目は無効に戻る -----------------------
  await expect(section).toHaveCount(0, { timeout: 20_000 });
  await expect.poll(() => menuItemEnabled(launched.app, '選択中の AI を終了')).toBe(false);
});
