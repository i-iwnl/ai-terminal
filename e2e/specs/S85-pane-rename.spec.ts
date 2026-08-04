import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

/**
 * メニュー項目の押下を模す。Main から Renderer へ menu:action を直接送る
 * （S63 の sendSessionFocus と同じ形）。
 *
 * **これだけでは「メニューに項目がある」ことは検証できない**ので、
 * 下でアプリケーションメニューの実物も走査する。
 */
async function sendMenuAction(app: LaunchedApp['app'], type: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, actionType) => {
    const win = BrowserWindow.getAllWindows()[0];
    win?.webContents.send('menu:action', { type: actionType });
  }, type);
}

/** アプリケーションメニューに、指定ラベルの項目が存在するか（入れ子を再帰的に見る）。 */
async function menuHasItem(app: LaunchedApp['app'], label: string): Promise<boolean> {
  return app.evaluate(({ Menu }, target) => {
    type MenuItemLike = { label?: string; submenu?: { items: MenuItemLike[] } };
    const walk = (items: MenuItemLike[]): boolean =>
      items.some((item) => item.label === target || (item.submenu ? walk(item.submenu.items) : false));
    const menu = Menu.getApplicationMenu();
    return menu === null ? false : walk(menu.items as MenuItemLike[]);
  }, label);
}

/**
 * Issue #130: 分割中のペインが自分の名前を名乗る。
 *
 * **この spec が守っている本題**は、`.pane-header` が `PaneLeaf.title` を
 * 反映することと、分割した2枚が**同時に別々の名前**を出せること。
 *
 * なぜ必要か: `useTabs.ts` の `splitActivePane` は必ず `spawnLeaf('shell', 'zsh', activeLeaf.cwd)`
 * を呼ぶ（分割で作れるのはシェルだけで、cwd は分割元から必ず引き継ぐ）。
 * したがって**分割した2枚のヘッダは 100% 必ず同一文字列になる**。名前を
 * 付けられなければ、どちらがどちらか文字からは永久に分からない。
 * この spec はまず「名前を付ける前は一致している」ことを assert してから、
 * 付けたあとに分かれることを見る（前提が崩れたら気づけるようにするため）。
 *
 * **`aria-hidden` のヘッダを見ているのに、なぜ `title` 属性と `aria-label` も
 * 見るのか**: `.pane-header` は `text-overflow: ellipsis` で省略される。
 * 分割の下限幅（`MIN_PANE_COLUMNS = 20`）ではヘッダの文字領域が約 148.6px しか
 * 無く、`claude (再開)・my-repo` だけで既に切れる。切れた文字列を読む手段が
 * 画面上にも読み上げにも1つも無い状態を作らないことが、単一スロット設計の
 * 前提条件になっている。
 *
 * **メニュー項目の存在も見る**（`ペイン名を変更...`）。それまでリネームは
 * `TabBar.tsx` の `onDoubleClick` だけで、`AppAction` にも `menu.ts` にも
 * 無く、キーボードから1手も到達できなかった（WCAG 2.1.1）。ここが無いと
 * 「動くが誰も見つけられない機能」になる（Issue #22 と同型）。
 */
test('S85 分割した2枚のペインに別々の名前を付けると、両方のヘッダに同時に出る', async () => {
  const { window, workDir } = launched;
  const cwdName = workDir.split('/').pop() as string;

  const panes = window.locator('.terminal-pane');
  const headers = window.locator('.pane-header');
  const activePane = window.locator('.terminal-pane.is-active');
  const inactivePane = window.locator('.terminal-pane:not(.is-active)');
  const titleInput = window.locator('.tab-bar__title-input');

  // --- 導線: メニューに項目があること -------------------------------------
  //
  // 「動くが見つけられない」を防ぐ関門。実装より先にここが赤くなる。
  expect(
    await menuHasItem(launched.app, 'ペイン名を変更...'),
    'アプリケーションメニューに「ペイン名を変更...」が無い（キーボードから到達できない）',
  ).toBe(true);

  // --- 起動直後: 1ペイン。ヘッダは出ない -----------------------------------
  await expect(panes).toHaveCount(1);
  await expect(headers).toHaveCount(0);
  await expect(window.locator('.terminal-pane.is-active .xterm-screen')).toContainText(
    new RegExp(`${cwdName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[%#]`),
    { timeout: 20_000 },
  );

  // --- Cmd+D: 右に分割 ------------------------------------------------------
  await window.keyboard.press('Meta+d');
  await expect(panes).toHaveCount(2);
  await expect(headers).toHaveCount(2);

  // --- 前提: 名前を付ける前、2枚のヘッダは同一文字列 -------------------------
  //
  // これがこの Issue が解いている問題そのもの。**前提が変わったら
  // （例えば分割時に別の既定名を振るようになったら）ここで気づける。**
  const beforeLeft = ((await inactivePane.locator('.pane-header').textContent()) ?? '').trim();
  const beforeRight = ((await activePane.locator('.pane-header').textContent()) ?? '').trim();
  expect(beforeLeft.length).toBeGreaterThan(0);
  expect(beforeLeft, '分割直後の2枚のヘッダが既に違う（この spec の前提が崩れている）').toBe(
    beforeRight,
  );

  // --- メニューからアクティブなペインに名前を付ける -------------------------
  await sendMenuAction(launched.app, 'rename-active-pane');
  await expect(titleInput).toBeVisible();
  // 分割中は「タブ名」ではなく「ペイン名」を名乗る（隣のペインの名前は変わらない）。
  await expect(titleInput).toHaveAttribute('aria-label', 'ペイン名を編集');

  const rightName = 'E2E-RIGHT-PANE';
  await titleInput.fill(rightName);
  await titleInput.press('Enter');
  await expect(titleInput).toHaveCount(0);

  // アクティブなペインのヘッダだけが変わり、もう片方は元のまま。
  await expect(activePane.locator('.pane-header')).toHaveText(rightName);
  await expect(inactivePane.locator('.pane-header')).toHaveText(beforeLeft);

  // --- 省略されても全文が読めること（title 属性）----------------------------
  //
  // 名前を出すと「種別・cwd」が可視から落ちるので、そちらは title 属性へ回る。
  const rightTitleAttr = await activePane.locator('.pane-header').getAttribute('title');
  expect(rightTitleAttr, 'ヘッダに title 属性が無い（切れた文字列を読む手段がゼロ）').not.toBeNull();
  expect(rightTitleAttr).toContain(rightName);
  expect(rightTitleAttr, 'title 属性に種別・cwd が残っていない').toContain(cwdName);

  // --- 読み上げの名前（role="group" の aria-label）--------------------------
  //
  // xterm は WebGL レンダラで canvas に描くため、screenReaderMode が false の
  // ペイン（分割中の非アクティブなペイン全部）は支援技術から見て中身が空。
  // この名前が唯一の情報源になる。可視テキストは先頭に来る（WCAG 2.5.3）。
  const rightAriaLabel = (await activePane.getAttribute('aria-label')) ?? '';
  expect(rightAriaLabel.startsWith(rightName), `aria-label が可視テキストで始まっていない: ${rightAriaLabel}`).toBe(true);
  expect(rightAriaLabel).toContain(cwdName);

  // --- もう片方のペインにも別の名前を付ける ---------------------------------
  //
  // **本題。** 2枚が同時に別々の名前を名乗れること。
  await window.keyboard.press('Meta+BracketRight');
  await expect(activePane.locator('.pane-header')).toHaveText(beforeLeft);

  await sendMenuAction(launched.app, 'rename-active-pane');
  await expect(titleInput).toBeVisible();
  const leftName = 'E2E-LEFT-PANE';
  await titleInput.fill(leftName);
  await titleInput.press('Enter');
  await expect(titleInput).toHaveCount(0);

  // 2枚のヘッダに、別々の名前が同時に出ている。
  await expect(headers).toHaveCount(2);
  await expect(headers.nth(0)).toHaveText(leftName);
  await expect(headers.nth(1)).toHaveText(rightName);

  // --- live region は1個のまま（S37 / S48 の不変条件を壊していない）---------
  //
  // ヘッダに aria-label / title を足しても、変化を告知する仕組みは増やさない。
  // 数え方は S48 に揃える（.xterm-accessibility 側は S37 が別途担保している）。
  await expect(window.getByRole('status')).toHaveCount(1);
});
