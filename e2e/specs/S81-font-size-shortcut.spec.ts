import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

/**
 * Issue #120 の周1。ターミナルの文字サイズをキーで変える。
 *
 * ## 何を直したのか
 *
 * 変更手段は設定ウィンドウの「表示 > サイズ」だけで、`Cmd+,` で開く -> 値を変える
 * -> 閉じる、というウィンドウの往復だった。フォントサイズは「合わなければ毎日触る」
 * 種類の設定で、それだけが往復を要求していた。
 *
 * **`Cmd+-` / `Cmd+0` は「何も起きない」のではなく、別のものが動いていた。**
 * `menu.ts` の `role: 'zoomIn' / 'zoomOut' / 'resetZoom'` は `actionItem()` を
 * 通らないため `registerAccelerator: false` が付かず、**menu.ts が謳う
 * 「キーを実際に拾うのは matchShortcut 1箇所」という原則の唯一の例外**だった。
 * 押すと Renderer 全体（サイドバーもタブバーも）の拡大率が変わり、しかも
 * `config.json` に保存されないので次回起動で戻る。
 *
 * 周1 で zoom の `role` を外し、同じキーを `AppConfig.fontSize` に割り当てた。
 * **「同じキーが2系統から発火しない」ことは `S36-application-menu.spec.ts` が
 * `role` の不在で固定している**（そちらは小文字で比べる。Electron は
 * `MenuItem.role` を正規化した小文字で返す）。
 *
 * ## ここで見ること
 *
 * 1. キーで xterm の文字サイズが変わる
 * 2. **サイドバーは変わらない**（zoom との決定的な違い。あちらはクロームごと拡縮した）
 * 3. `config.json` に保存される = `AppConfig` に載る
 * 4. `Cmd+0` で既定に戻る
 */

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

test('S81 Cmd+= / Cmd+- でターミナルの文字サイズだけが変わり、設定に保存される', async () => {
  const { window } = launched;

  const rows = window.locator('.terminal-pane__container .xterm-rows').first();
  await expect(window.locator('.terminal-pane__container .xterm-screen').first()).toContainText(
    /[$%#>]/,
    { timeout: 20_000 },
  );

  const fontSize = async (): Promise<number> =>
    Number.parseFloat(await rows.evaluate((el) => getComputedStyle(el).fontSize));
  const sidebarWidth = async (): Promise<number> =>
    Math.round(
      (await window.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().width)) as number,
    );
  const configFontSize = async (): Promise<number> =>
    window.evaluate(() => window.api.config.get().then((c) => c.fontSize));

  expect(await fontSize(), '既定').toBe(13);
  const sidebarBefore = await sidebarWidth();

  // --- 大きく -----------------------------------------------------------------
  await window.keyboard.press('Meta+=');
  await expect.poll(fontSize, { timeout: 10_000 }).toBe(14);
  await window.keyboard.press('Meta+=');
  await expect.poll(fontSize, { timeout: 10_000 }).toBe(15);

  // **サイドバーは動かない。** ここが Electron の zoom との決定的な違いで、
  // zoom を捨ててこちらに寄せた理由そのもの。
  expect(await sidebarWidth(), 'クロームは拡縮しない').toBe(sidebarBefore);

  // **設定に載る**（zoom は載らず、次回起動で戻っていた）。
  await expect.poll(configFontSize, { timeout: 10_000 }).toBe(15);

  // --- 小さく -----------------------------------------------------------------
  await window.keyboard.press('Meta+-');
  await expect.poll(fontSize, { timeout: 10_000 }).toBe(14);

  // --- 既定へ戻す -------------------------------------------------------------
  await window.keyboard.press('Meta+0');
  await expect.poll(fontSize, { timeout: 10_000 }).toBe(13);
  await expect.poll(configFontSize, { timeout: 10_000 }).toBe(13);

  // --- Cmd+1 がタブ切替のままであること ---------------------------------------
  // `Cmd+0` を足すときに `/^[1-9]$/` を `[0-9]` へ広げると、`Cmd+1` の index が
  // -1 になって壊れる（`test/unit/renderer-lib.test.ts` が index 側から固定
  // しているが、実際に押しても壊れないことをここで見る）。
  await window.keyboard.press('Meta+1');
  await expect(window.locator('.tab-bar__tab').first()).toHaveClass(/is-active/);
});
