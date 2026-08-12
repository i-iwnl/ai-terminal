import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';
import { readKilledTmuxSessions, waitForNewTmuxSessionName } from '../fixtures/tmuxLivePanes';

let launched: LaunchedApp;

test.beforeEach(async () => {
  // **偽 tmux + `useTmux: true`。** これが無いと `wrappedInTmux` が立たず、
  // 「閉じると AI が終了する」状態そのものを作れない（S84 と同じ構成）。
  launched = await launchApp({ config: { useTmux: true }, fakeTmux: true });
});

test.afterEach(async () => {
  await closeApp(launched);
});

/** メニュー項目を Main プロセス側で探して押す（S36 と同じ手口）。 */
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

/** メニュー項目が有効かどうか。 */
async function menuItemEnabled(app: LaunchedApp['app'], label: string): Promise<boolean | null> {
  return app.evaluate(({ Menu }, target) => {
    const menu = Menu.getApplicationMenu();
    if (!menu) return null;
    let found: Electron.MenuItem | undefined;
    const walk = (items: Electron.MenuItem[]): void => {
      for (const item of items) {
        if (item.label === target) found = item;
        if (item.submenu) walk(item.submenu.items);
      }
    };
    walk(menu.items);
    return found ? found.enabled : null;
  }, label);
}

/**
 * Issue #158 / #244。**「閉じる」の2つの意味が、それぞれ正しく効くこと。**
 *
 * #158 の時点では `Cmd+W` が確認の判定を通ることだけを見ていた。
 * **#244 で「閉じる」の意味そのものが変わった**ので、この spec も対を見る形へ書き直した。
 *
 * | 操作 | AI | 告知の面 |
 * |---|---|---|
 * | `Cmd+W` / `Cmd+Option+W` / タブバーの x | **終了する** | live region（目で見て分かる結果なので） |
 * | メニュー「AI を残してタブを閉じる」 | **残る** | 通知バナー（**残ったことは目で見えない**） |
 *
 * ⭐ **片方だけ見ると、両方とも通る実装が緑になる。**
 * 「常に終了する」実装は 2 を、「常に残す」実装は 1 を、それぞれ落とせない。
 *
 * ⛔ **面を取り違えないこと**（design-rules 節8）。`.app-status` は
 * `clip: rect(0,0,0,0)` で画面から隠されているので、**目で見えない事実をそこへ流すと
 * 支援技術利用者にしか届かない**。逆に、目で見て分かる結果をバナーに出すと
 * 1日に何十回の雑音になる。判定の正は `closedTabChannel()`。
 *
 * ⛔ 見出し・文言に「実行中」「回収」を出さない（design-rules の禁止語 / 内部語）。
 */
test('S90 閉じれば AI は終了し、メニューから明示したときだけ残る', async () => {
  const { window, fixturesDir } = launched;

  const tabs = window.locator('.tab-bar__tab');
  const dialog = window.locator('[role="alertdialog"]');
  const notices = window.locator('.notice-banner');
  const status = window.locator('.app-status');
  const readKilled = (): string => readKilledTmuxSessions(fixturesDir);

  await expect(tabs).toHaveCount(1, { timeout: 15_000 });
  await expect(window.locator('.terminal-pane__container .xterm-screen').first()).toContainText(
    /[$%#>]/,
    { timeout: 20_000 },
  );

  // --- 否定側を先に見る: シェルタブでは確認も出ず、「残す」も選べない -----------
  //
  // シェルは `maybeWrapWithTmux` が必ず素通しするので `wrappedInTmux` は false。
  // ⭐ **「AI を残してタブを閉じる」は無効化する。非表示にはしない**（macOS の作法。
  // 項目の位置が動くと学習が壊れる。design-review で4人が一致）。
  await window.keyboard.press('Meta+t');
  await expect(tabs).toHaveCount(2, { timeout: 15_000 });
  await expect
    .poll(() => menuItemEnabled(launched.app, 'AI を残してタブを閉じる'), { timeout: 10_000 })
    .toBe(false);

  await window.keyboard.press('Meta+w');
  await expect(tabs).toHaveCount(1, { timeout: 15_000 });
  await expect(dialog).toHaveCount(0);

  // --- 本題1: `Cmd+W` は tmux でラップされた gemini を終了する -------------------
  await window.keyboard.press('Meta+Shift+E');
  await expect(tabs).toHaveCount(2, { timeout: 15_000 });
  await expect(window.locator('.tab-bar__tab--gemini')).toHaveCount(1, { timeout: 15_000 });
  // ラップされたことを画面から確認する（`wrappedInTmux` が Renderer まで届いて
  // いなければ、以降の assert は別の理由で通ってしまう。S84 と同じ hook）。
  await window.keyboard.press('Meta+f');
  await expect(window.locator('.terminal-search__hint')).toBeVisible({ timeout: 15_000 });
  await window.keyboard.press('Escape');

  // 残せる AI が居るので、メニュー項目は有効になっている。
  await expect
    .poll(() => menuItemEnabled(launched.app, 'AI を残してタブを閉じる'), { timeout: 10_000 })
    .toBe(true);

  const terminatedSession = await waitForNewTmuxSessionName(fixturesDir, '');

  await window.keyboard.press('Meta+w');
  await expect(tabs).toHaveCount(1, { timeout: 15_000 });
  await expect(dialog).toHaveCount(0);

  // ⭐ 実際に終了させている。
  await expect
    .poll(readKilled, { timeout: 15_000, message: 'Cmd+W が tmux セッションを終了させていない' })
    .toContain(terminatedSession);

  // ⭐ **告知は live region に1回だけ**（目で見て分かる結果なので、バナーは出さない）。
  await expect(status).toContainText('終了しました', { timeout: 15_000 });
  // ⛔ 事実と逆の旧文言が残っていないこと。**ここが #244 以前の嘘そのもの。**
  await expect(status).not.toContainText('終了せず残っています');
  await expect(notices).toHaveCount(0);

  // --- 本題2: メニューから明示したときだけ、AI は残る --------------------------
  await window.keyboard.press('Meta+Shift+E');
  await expect(window.locator('.tab-bar__tab--gemini')).toHaveCount(1, { timeout: 15_000 });
  await expect(tabs).toHaveCount(2, { timeout: 15_000 });
  const keptSession = await waitForNewTmuxSessionName(fixturesDir, terminatedSession);

  await expect
    .poll(() => clickMenuItem(launched.app, 'AI を残してタブを閉じる'), { timeout: 10_000 })
    .toBe(true);
  await expect(tabs).toHaveCount(1, { timeout: 15_000 });

  // ⭐ **こちらは通知バナー**（残ったことは目で見えないので、視覚面に出す）。
  await expect(notices).toContainText(['終了せず残っています'], { timeout: 15_000 });
  await expect(notices).toContainText(['Gemini 1 件']);
  // ⛔ 同じ文を live region にも流さない（VoiceOver が2回読む）。
  await expect(status).not.toContainText('終了せず残っています');
  // ⭐ そして**終了させていない**。
  expect(readKilled(), 'AI を残すはずなのに tmux セッションを終了させている').not.toContain(
    keptSession,
  );

  // --- 本題3: 2枚を一度に閉じるときは、いまも確認が出る -------------------------
  //
  // **確認の機構ごと消す直し方**（`needsCloseConfirmation` が常に false）でも
  // 上までは green になるので、残っている条件を必ず1つ踏む。
  await window.keyboard.press('Meta+Shift+E');
  await expect(tabs).toHaveCount(2, { timeout: 15_000 });
  await expect(window.locator('.tab-bar__tab--gemini')).toHaveCount(1, { timeout: 15_000 });
  await window.keyboard.press('Meta+d');

  // ⛔ **`.terminal-pane` の総数で分割を確かめない。** この時点でタブが2枚あるので、
  // 分割していなくても総数は2になる（実際にこれで空振りした）。
  await expect(tabs.nth(1).locator('.tab-bar__close')).toHaveAttribute(
    'aria-label',
    'タブを閉じる（2 ペイン）',
    { timeout: 15_000 },
  );

  await window.keyboard.press('Meta+Alt+w');

  await expect(dialog).toBeVisible({ timeout: 10_000 });
  // ⭐ 確認の文言も「終了します」側になっていること（#244 以前は
  // 「AI の作業は続きます」と出ており、確定した瞬間に嘘になっていた）。
  await expect(dialog).toContainText('終了します');
  await expect(dialog).not.toContainText('続きます');
  await expect(tabs).toHaveCount(2);

  // キャンセルすればタブは残る（確認が形だけになっていないこと）。
  await window.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(tabs).toHaveCount(2);
});
