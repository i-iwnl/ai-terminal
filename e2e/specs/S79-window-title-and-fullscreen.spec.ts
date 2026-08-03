import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

/**
 * Issue #119 の周5（#20 の K-5 / K-10）。
 *
 * ## 1. ウィンドウタイトルをアクティブなタブに同期する
 *
 * `titleBarStyle: 'hiddenInset'` なのでタイトルバーには出ないが、
 * **ウィンドウメニュー・Mission Control・App Exposé には出る。**
 * 3つのリポジトリで同じアプリを開いていると、いまはどれも同じ名前で並び、
 * **どのウィンドウがどのプロジェクトかを見分ける手がかりが無い。**
 *
 * `win.setTitle()` の呼び出しはリポジトリ内に **0 箇所**だった。
 *
 * ## 2. フルスクリーンでドラッグ帯を畳む
 *
 * フルスクリーン中は macOS が信号機ボタンを隠すので、その下敷きにしている
 * `.sidebar__drag-region`（36px）を残すと**何も無い帯だけがターミナルの上に
 * 居座る**。`enter-full-screen` / `leave-full-screen` の購読もリポジトリ内に
 * **0 箇所**だった。
 *
 * **Renderer からは判定できない。** `window.innerHeight` や HTML5 の
 * Fullscreen API は要素の全画面表示で、macOS のウィンドウのフルスクリーンとは
 * 別物。Main から `IpcEvent.fullScreenChanged` で流す。
 *
 * > **タブバーは畳まない。** タブは全画面でも要る（畳むとタブの切り替えが
 * > マウスから不可能になる）。
 *
 * > **`trafficLightPosition` の再適用はここでは検証できない。** Electron に
 * > 読み戻す API が無く（S73 のコメント参照）、信号機はネイティブの NSButton で
 * > DOM にも現れない。復帰時に `setWindowButtonPosition` を呼んでいることまでが
 * > 実装の担保で、位置の一致は `test/unit/css-tokens.test.ts` が導出ごと固定している。
 */

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

test('S79 ウィンドウタイトルがアクティブなタブに追従し、フルスクリーンで帯が畳まれる', async () => {
  const { window, app } = launched;

  const screen = window.locator('.terminal-pane__container .xterm-screen').first();
  await expect(screen).toContainText(/[$%#>]/, { timeout: 20_000 });

  const readTitle = (): Promise<string> =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle() ?? '');

  // --- 1. タイトルが最初のタブの名前になっている ------------------------------
  const firstTabTitle = await window.locator('.tab-bar__tab .tab-bar__title').first().innerText();
  expect(firstTabTitle.trim(), 'タブ名が空では検証にならない').not.toBe('');
  await expect.poll(readTitle, { timeout: 10_000 }).toBe(firstTabTitle.trim());

  // --- 2. タブを増やして切り替えると追従する ----------------------------------
  await window.locator('.tab-bar__new').click();
  await window.locator('.tab-bar__new-menu-item', { hasText: 'Claude' }).click();
  const tabs = window.locator('.tab-bar__tab');
  await expect(tabs).toHaveCount(2, { timeout: 15_000 });

  const secondTabTitle = await tabs.nth(1).locator('.tab-bar__title').innerText();
  await expect.poll(readTitle, { timeout: 10_000 }).toBe(secondTabTitle.trim());
  // 2枚のタブで名前が違うことまで見ないと、「たまたま同じ」で通ってしまう。
  expect(secondTabTitle.trim()).not.toBe(firstTabTitle.trim());

  // 1枚目へ戻すと戻る。
  await tabs.nth(0).locator('.tab-bar__tab-button').click();
  await expect.poll(readTitle, { timeout: 10_000 }).toBe(firstTabTitle.trim());

  // --- 3. フルスクリーンで帯が畳まれる ----------------------------------------
  const dragRegion = window.locator('.sidebar__drag-region');
  const tabBar = window.locator('.tab-bar');

  const heightOf = async (loc: typeof dragRegion): Promise<number> =>
    Math.round((await loc.evaluate((el) => el.getBoundingClientRect().height)) as number);

  expect(await heightOf(dragRegion), 'フルスクリーン前の帯').toBe(36);

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setFullScreen(true);
  });

  await expect(window.locator('.app')).toHaveClass(/is-fullscreen/, { timeout: 15_000 });
  await expect.poll(async () => heightOf(dragRegion), { timeout: 10_000 }).toBe(0);
  // **タブバーは畳まない**（畳むとタブの切り替えがマウスから不可能になる）。
  expect(await heightOf(tabBar), 'フルスクリーンでもタブバーは残る').toBe(36);

  // --- 4. 戻すと帯も戻る -------------------------------------------------------
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setFullScreen(false);
  });

  await expect(window.locator('.app')).not.toHaveClass(/is-fullscreen/, { timeout: 15_000 });
  await expect.poll(async () => heightOf(dragRegion), { timeout: 10_000 }).toBe(36);
});
