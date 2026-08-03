import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

/**
 * Issue #119 の周4（#20 の PR 16）。**ドラッグの代替手段**（WCAG 2.5.7
 * Dragging Movements）。
 *
 * ポインタのドラッグでしか到達できない機能は、ドラッグ以外の単一ポインタ操作でも
 * 達成できなければならない。サイドバーの幅は「表示」メニューの
 * `サイドバーを広げる / 狭める / 幅を既定に戻す` が担う。
 *
 * **アクセラレータは持たせない。** `menu.ts` の
 * `分割比を広げる / 狭める / 50%に戻す`（`accelerator: undefined`）と同じ形。
 * 幅調整は 2〜5回/日（初日以降ほぼ0）で、`Cmd+英数字` の名前空間は
 * 100手/日級の操作（タブ切替・「あなたの番」へのジャンプ）のために空けておく。
 *
 * ドラッグ本体と「ドラッグ中は `pty:resize` が飛ばない」関門は S76 が見る。
 */

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

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
    if (!target?.click) return false;
    target.click();
    return true;
  }, label);
}

async function sidebarWidth(app: LaunchedApp): Promise<number> {
  const box = await app.window.locator('.sidebar').boundingBox();
  if (!box) throw new Error('.sidebar の boundingBox が取得できなかった');
  return Math.round(box.width);
}

test('S77 サイドバーの幅をメニューから変えられる（ドラッグの代替手段）', async () => {
  const { window, app } = launched;

  const screen = window.locator('.terminal-pane__container .xterm-screen').first();
  await expect(screen).toContainText(/[$%#>]/, { timeout: 20_000 });

  expect(await sidebarWidth(launched)).toBe(260);

  // WCAG 2.5.7 Dragging Movements の Equivalent。
  expect(await clickMenuItem(app, 'サイドバーを広げる')).toBe(true);
  await expect.poll(async () => sidebarWidth(launched)).toBe(280);

  expect(await clickMenuItem(app, 'サイドバーを狭める')).toBe(true);
  expect(await clickMenuItem(app, 'サイドバーを狭める')).toBe(true);
  await expect.poll(async () => sidebarWidth(launched)).toBe(240);

  expect(await clickMenuItem(app, 'サイドバーの幅を既定に戻す')).toBe(true);
  await expect.poll(async () => sidebarWidth(launched)).toBe(260);

  // **アクセラレータを持たないこと。** 幅調整は 2〜5回/日（初日以降ほぼ0）で、
  // `Cmd+英数字` の名前空間は 100手/日級の操作のために空けておく。
  const accelerators = await app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu();
    if (!menu) return null;
    // **Electron は accelerator 未設定のとき `null` を返す**（`undefined` ではない）。
    // `evaluate` の戻り値は構造化クローンを通るので、ここで正規化しておく。
    const found: Array<string | null> = [];
    const walk = (items: Electron.MenuItem[]): void => {
      for (const item of items) {
        if (item.label.startsWith('サイドバーを') || item.label.startsWith('サイドバーの幅')) {
          found.push(item.accelerator ?? null);
        }
        if (item.submenu) walk(item.submenu.items);
      }
    };
    walk(menu.items);
    return found;
  });
  // 「サイドバーを広げる / 狭める / 幅を既定に戻す」の3件。
  // 「サイドバーの表示を切り替え」は Cmd+Option+S を持つので、前方一致から外れる
  // ラベル（`サイドバーの表示` は `サイドバーの幅` では始まらない）にしてある。
  expect(accelerators).toEqual([null, null, null]);
});
