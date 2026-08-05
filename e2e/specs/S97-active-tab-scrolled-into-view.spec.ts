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
 * Issue #180 引き継ぎ周7（材料は `.claude/workspace/issue-179/known-issues.md` 11番）。
 *
 * **タブが溢れているとき、選ばれたタブが画面外に着地する。**
 * `scrollIntoView` / `scrollLeft` は `src/renderer/` に **0件**だった。
 *
 * ⚠ **`S54` が12枚で緑なのは、この不具合が無いことの根拠にならない。**
 * あちらは**キーボードでタブバーの中を移動する**経路で、`focus()` の副作用として
 * ブラウザが勝手にスクロールインしている。壊れているのは
 * **DOM フォーカスを1ミリも動かさない経路** = `Cmd+1-9` / `Cmd+Shift+]` / `Cmd+J` / 通知クリック。
 *
 * ヘビーユーザーの実測では、既定 1200px で同時に見えるのは約 7.2 枚。
 * 実運用 8〜12 枚なので **28% が画面外**に居り、そこへ着地するたびに復旧で2手かかる。
 */
test('S97 タブが溢れていても、選ばれたタブは可視域へスクロールインする', async () => {
  const { window } = launched;

  const tabs = window.locator('.tab-bar__tab');
  const tabButtons = window.locator('.tab-bar__tab-button');
  await expect(tabs).toHaveCount(1);

  for (let i = 0; i < 11; i += 1) {
    await window.keyboard.press('Meta+t');
  }
  await expect(tabs).toHaveCount(12, { timeout: 20_000 });

  // **この検査が意味を持つ条件を、同じ spec の中で固定する。**
  // タブが溢れていなければ「画面外に着地する」も「スクロールインする」も起こらず、
  // 実装を丸ごと消しても緑のままになる（`spec-writing-traps.md` の
  // 「検査は正しいが、その条件を踏んでいない」）。
  const overflow = await window
    .locator('.tab-bar__tabs')
    .evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  expect(
    overflow.scrollWidth,
    'タブが溢れていない。この spec の前提が崩れている（ウィンドウ幅かタブ幅が変わった）',
  ).toBeGreaterThan(overflow.clientWidth);

  // 12枚目が選択中。**キーボードでタブバーの中を移動する経路は既に効いている**ので、
  // ここでは使わない。代わりに `.tab-bar__tabs` を右端まで送って
  // 「1枚目が画面外」という状況を作る。
  await window.locator('.tab-bar__tabs').evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  await expect(tabButtons.nth(0)).not.toBeInViewport();

  // --- (1) Cmd+1（DOM フォーカスを動かさない経路） ---------------------------
  //
  // ⚠ **フォーカスは端末にある。** `setActiveTabId` はタブボタンに `focus()` しないので、
  // ブラウザ任せのスクロールインは起きない。
  await window.keyboard.press('Meta+1');
  await expect(tabs.nth(0)).toHaveClass(/is-active/);
  await expect(
    tabButtons.nth(0),
    'Cmd+1 で選んだタブが画面外に着地している（復旧に2手かかる）',
  ).toBeInViewport();

  // --- (2) Cmd+Shift+]（次のタブへ）------------------------------------------
  //
  // ⚠ **スクロール位置を左端へ戻してから測る。** 戻さないと、右端に居るままなので
  // **12枚目は最初から見えていて、実装を消しても緑になる**（初版はこの形で、
  // 実際に恒真だった）。`spec-writing-traps.md` の「検査は正しいが、その条件を踏んでいない」。
  await window.locator('.tab-bar__tabs').evaluate((el) => {
    el.scrollLeft = 0;
  });
  await expect(tabButtons.nth(11)).not.toBeInViewport();

  // 1枚目が見えている状態から、12枚目まで送る。**最後の1回で必ず溢れる。**
  for (let i = 0; i < 11; i += 1) {
    await window.keyboard.press('Meta+Shift+BracketRight');
  }
  await expect(tabs.nth(11)).toHaveClass(/is-active/);
  await expect(
    tabButtons.nth(11),
    'Cmd+Shift+] で送った先のタブが画面外に着地している',
  ).toBeInViewport();

  // --- (3) 新しいタブを開いたときも、その1枚が見えていること -------------------
  //
  // ⚠ **下の「タブバーが縦に押し出されていない」は、いまは恒真の見張り（カナリア）。**
  // `block: 'nearest'` を外して既定の `'start'` に戻しても**赤くならないことを実測した**。
  // いまの DOM では縦に送れる余地が無いため（`body { overflow: hidden }` でページは
  // スクロールせず、`.tab-bar__tabs` は `overflow-x: auto` でスクロールコンテナには
  // なっているが、中身の高さがコンテナと同じ）。
  //
  // **それでも残す。** Issue #170 は「`overflow-x: auto` が `overflow-y` も `auto` にする」
  // 性質でタブが縦に切られた事故で、**同じ幾何がもう一度生まれた日にだけ**この行が意味を持つ。
  // ⛔ **「いま赤くならない検査がある」ことを黙って持たない**ので、ここに明記しておく。
  // 実装側の `block: 'nearest'` を外してよい理由にはならない（外す理由も無い）。
  const barTopBefore = await window
    .locator('.tab-bar')
    .evaluate((el) => el.getBoundingClientRect().top);
  await window.keyboard.press('Meta+t');
  await expect(tabs).toHaveCount(13, { timeout: 20_000 });
  await expect(tabButtons.nth(12), '新しく開いたタブが画面外にある').toBeInViewport();
  const barTopAfter = await window
    .locator('.tab-bar')
    .evaluate((el) => el.getBoundingClientRect().top);
  expect(barTopAfter, 'タブバーが縦に押し出された（block: nearest が抜けている）').toBe(
    barTopBefore,
  );
});
