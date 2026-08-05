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
 * Issue #20 I-1（PR 12）。
 *
 * `TabBar` の「+」は `newShellTab` 固定で、`newAgentTab` を呼べるのは
 * メニュー（menu.ts）と `Cmd+Shift+C` / `Cmd+Shift+E` だけだった。説明書を
 * 読まない初見ユーザーがこのアプリの存在理由（AI CLI を飼う）へ画面上から
 * 到達する手段が無かったため、「+」を分割ボタン（+ ▾）にする。
 */
test('S64 「+ ▾」で新しいシェル / Claude / Gemini を選んで開ける', async () => {
  const { window } = launched;

  const newButton = window.locator('button[aria-label="新しいタブを開く"]');
  const menu = window.locator('.tab-bar__new-menu');
  const tabs = window.locator('.tab-bar__tab');

  await expect(tabs).toHaveCount(1);
  await expect(menu).toHaveCount(0);
  await expect(newButton).toHaveAttribute('aria-expanded', 'false');

  // メニューを開くと3項目（シェル / Claude / Gemini）が並ぶこと。
  // **3つとも裸の名詞**（Issue #137。以前は1つ目だけ「新しいシェル」だった）。
  await newButton.click();
  await expect(menu).toBeVisible();
  await expect(newButton).toHaveAttribute('aria-expanded', 'true');
  const items = menu.locator('[role="menuitem"]');
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toHaveText('シェル');
  await expect(items.nth(1)).toHaveText('Claude');
  await expect(items.nth(2)).toHaveText('Gemini');

  // 開いたら最初の項目にフォーカスが移ること（WAI-ARIA APG のメニューボタンパターン）。
  expect(await items.nth(0).evaluate((el) => el === document.activeElement)).toBe(true);

  // Escape で閉じ、トリガーへフォーカスが戻ること。
  await window.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  expect(await newButton.evaluate((el) => el === document.activeElement)).toBe(true);

  // 外側クリックでも閉じること。
  await newButton.click();
  await expect(menu).toBeVisible();
  await window.locator('.tab-bar__drag-region').click({ position: { x: 5, y: 5 } });
  await expect(menu).toHaveCount(0);

  // --- Issue #180 引き継ぎ周5-b（PR 1 = characterization）--------------------
  //
  // **いま壊れている振る舞いを、壊れたまま固定する。** ここから下の3つは
  // 「あるべき姿」ではない。**PR 3 でひっくり返す**ためにいまの姿を記録している。
  // 固定しておかないと、直したことを差分で見せられない。
  //
  // ⛔ **「外側クリックのあとフォーカスが `<body>` に落ちている」は、ここでは固定しない。**
  // 実測（PR 1 の関門確認）: `mousedown` のハンドラの中で `newButtonRef.focus()` を
  // 呼んでも **`mousedown` の既定動作があとから上書きする**ので、`activeElement` は
  // `body` のまま = **是正を入れても赤くならない恒真の検査になる**。
  // `requestAnimationFrame` で遅らせると戻るが、**戻る時刻がフレーム境界に依存する**ので
  // 「落ちている」という否定形の assert は安定しない。
  // **是正側（フォーカスがトリガーに戻っている）を `expect.poll` で待つ形にして PR 3 で足す。**

  await newButton.click();
  await expect(menu).toBeVisible();

  // (1) マウスで開くと、選ばれている項目に色が1つも付かない。
  //     開いた瞬間に先頭項目へ DOM フォーカスは移っている（上で確認済み）が、
  //     `:focus-visible` は**マウス起点の `.focus()` では発火しない**ので、
  //     `.tab-bar__new-menu-item:hover, :focus-visible` の宣言がどちらも当たらない。
  //     **どの項目が選ばれているか画面に出ていない**（WCAG 2.4.7）。
  //     ⛔ ここを比で測らない。透明な背景は contrast.ts が落とす（架空の比を作らないため）。
  expect(await items.nth(0).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    'rgba(0, 0, 0, 0)',
  );

  // (2) **光っている行はちょうど1つ。**
  //     いまキーボードのフォーカスは項目0、マウスは項目2に乗せる。
  //     現状 (1) の裏返しで光るのはホバー側だけなので 1。
  //     ⚠ **PR 2 で `:focus-visible` を `:focus` に変えると、対処しない限り 2 になる**
  //     （フォーカスとホバーが別の行にあるので両方光る）。この関門はその退行のためにある。
  await items.nth(2).hover();
  expect(
    await menu.evaluate(
      (el) =>
        [...el.querySelectorAll('[role="menuitem"]')].filter(
          (item) => getComputedStyle(item).backgroundColor !== 'rgba(0, 0, 0, 0)',
        ).length,
    ),
  ).toBe(1);

  // (3) `Tab` はメニューを閉じない。しかも1回目は**メニューの中**へ進む。
  //     3項目とも `tabIndex === 0` のままで、APG の roving tabindex が入っていない。
  //     外へ出るのは3回目で、そのときも `aria-expanded="true"` のまま
  //     メニューが端末の上に貼り付いて残る。
  await window.keyboard.press('Tab');
  expect(await items.nth(1).evaluate((el) => el === document.activeElement)).toBe(true);
  await window.keyboard.press('Tab');
  await window.keyboard.press('Tab');
  await expect(menu).toBeVisible();
  await expect(newButton).toHaveAttribute('aria-expanded', 'true');
  expect(
    await window.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? ''),
  ).toBe('設定を開く');

  await window.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  // 「Claude」を選ぶと claude タブが開くこと。
  await newButton.click();
  await menu.locator('[role="menuitem"]', { hasText: 'Claude' }).click();
  await expect(menu).toHaveCount(0);
  await expect(tabs).toHaveCount(2);
  await expect(window.locator('.tab-bar__tab--claude')).toHaveCount(1);
  const claudeScreen = window.locator('.terminal-pane:not(.terminal-pane--hidden) .xterm-rows').first();
  await expect(claudeScreen).toContainText('FAKE CLAUDE READY', { timeout: 20_000 });

  // 「Gemini」を選ぶと gemini タブが開くこと。
  await newButton.click();
  await expect(menu).toBeVisible();
  await menu.locator('[role="menuitem"]', { hasText: 'Gemini' }).click();
  await expect(tabs).toHaveCount(3);
  await expect(window.locator('.tab-bar__tab--gemini')).toHaveCount(1);
  const geminiScreen = window.locator('.terminal-pane:not(.terminal-pane--hidden) .xterm-rows').first();
  await expect(geminiScreen).toContainText('FAKE GEMINI READY', { timeout: 20_000 });
});
