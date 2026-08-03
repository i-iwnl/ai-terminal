import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

/**
 * Issue #120 の周2（旧 #111）。サイドバーの3パネルをキーボードから切り替える。
 *
 * ## 何が壊れていたか
 *
 * 3パネル切替（タスク / 履歴 / メモ）は素の `<button>` 3つで、**マウスでしか
 * 押せなかった。** キーボードからの到達手段が1つも無い:
 *
 * - `shortcuts.ts` にパネル切替の分岐が無い
 * - `AppAction` に該当する種別が無い（`switch-tab` はタブバーであってサイドバーではない）
 * - `menu.ts` に `サイドバー` / `タスク` / `履歴` / `メモ` のいずれの語も 0 箇所
 * - **`Tab` キーでも到達できない。** `<button>` 自体はネイティブにフォーカス可能だが、
 *   xterm のヘルパー textarea が Tab を端末入力として消費する。フォーカスが
 *   ターミナルにある限り DOM のフォーカス順に出られない
 *
 * WCAG 2.1.1（キーボード）。
 *
 * 選択状態も `className` の `is-active` だけで、`role` / `aria-selected` /
 * `aria-current` のいずれも無かった。塗りの差は `--surface-3` 対 `--surface-2` で
 * **1.08**（S40 が `wcag: 'fail'` で実測固定）なので、支援技術にも
 * 色の弱い利用者にも選択が伝わっていない。WCAG 4.1.2（名前・役割・値）。
 *
 * ## キーの選び方
 *
 * **`Cmd+Shift+1/2/3` は使えない。** `Cmd+Shift+3` / `4` / `5` は macOS の
 * スクリーンショットにシステム側が先に奪うので、アプリに届かない。
 * 「3パネルだから 1/2/3」という並びは3番目で必ず破綻する。
 *
 * `Cmd+Option+` に寄せたのは、既に `Cmd+Option+S`（サイドバーの表示切替）が
 * そこにあるため。**判定は `e.code`**（Option+1 は `e.key` が `¡` になる）。
 *
 * ## `<button>` 要素そのものは変えていない
 *
 * `e2e/` の 28 ファイル・44 箇所が `.sidebar__tabs button` でパネルを切り替える。
 * 要素を `<div role="tab">` に置き換えると全部落ちる。**`role` を足すだけ。**
 */

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

test('S83 Cmd+Option+1/2/3 でサイドバーのパネルを切り替えられ、選択が機械可読になっている', async () => {
  const { window } = launched;

  await expect(window.locator('.terminal-pane__container .xterm-screen').first()).toContainText(
    /[$%#>]/,
    { timeout: 20_000 },
  );

  const tabs = window.locator('.sidebar__tabs button');
  await expect(tabs).toHaveCount(3);

  // --- 選択が機械可読であること（キーの新設とは独立に効く） --------------------
  await expect(window.locator('.sidebar__tabs')).toHaveAttribute('role', 'tablist');
  for (const t of await tabs.all()) {
    await expect(t).toHaveAttribute('role', 'tab');
  }
  // 起動直後はタスク。
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'false');
  await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'false');

  // roving tabindex。`role="tablist"` の停止点は1つであるべき
  // （**Tab では到達できないが、ARIA で嘘をつかないために数は正しくしておく**）。
  const tabIndexes = await tabs.evaluateAll((els) => els.map((el) => el.tabIndex));
  expect(tabIndexes).toEqual([0, -1, -1]);

  // tab と tabpanel が id で結ばれていること。
  const controls = await tabs.nth(0).getAttribute('aria-controls');
  await expect(window.locator('.sidebar__content')).toHaveAttribute('id', controls ?? '');
  await expect(window.locator('.sidebar__content')).toHaveAttribute('role', 'tabpanel');

  // --- キーボードで切り替わること ---------------------------------------------
  // **`Alt+Digit2` を送る。** macOS では Option+2 の `key` は `™` になるため、
  // 実装側は `e.code` で判定している（Playwright の `Alt+Digit2` は code を送る）。
  await window.keyboard.press('Meta+Alt+Digit2');
  await expect(window.locator('.history-list')).toBeVisible({ timeout: 10_000 });
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'false');

  await window.keyboard.press('Meta+Alt+Digit3');
  await expect(window.locator('.memo-panel')).toBeVisible({ timeout: 10_000 });
  await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');

  await window.keyboard.press('Meta+Alt+Digit1');
  await expect(window.locator('.task-list')).toBeVisible({ timeout: 10_000 });
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');

  // --- 畳んでいるときは開いてから切り替える -----------------------------------
  // **「何も起きない」で終わらせない**（U4）。畳んだまま切り替えても
  // 画面は1pxも動かず、壊れて見える。
  await window.keyboard.press('Meta+Alt+s');
  await expect(window.locator('.sidebar')).toHaveClass(/is-collapsed/);

  await window.keyboard.press('Meta+Alt+Digit2');
  await expect(window.locator('.sidebar')).not.toHaveClass(/is-collapsed/, { timeout: 10_000 });
  await expect(window.locator('.history-list')).toBeVisible({ timeout: 10_000 });
});
