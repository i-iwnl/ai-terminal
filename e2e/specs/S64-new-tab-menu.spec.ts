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

  // (1) **マウスで開いても、選ばれている項目が見える。**
  //     `:focus-visible` はマウス起点の `.focus()` では発火しないので、
  //     以前はここが `rgba(0, 0, 0, 0)`（塗りが1つも当たらない）だった = 2.4.7 違反。
  //     roving focus のメニューでは DOM フォーカスが選択カーソルそのものなので、
  //     `:focus` で描くのが正しい（styles.css）。
  //
  //     **選択状態を担うのは塗りではなく白 2px の線。** 塗りは対メニュー面 1.30 で
  //     3:1 に届かない（届く明るさにすると文字が 4.5:1 を割る）。線は 11.37。
  //     ⛔ 塗りだけを見て「見えるようになった」と判定しない。
  const selectedStyle = await items
    .nth(0)
    .evaluate((el) => {
      const s = getComputedStyle(el);
      return { background: s.backgroundColor, shadow: s.boxShadow };
    });
  expect(selectedStyle.background).toBe('rgb(58, 58, 58)');
  expect(selectedStyle.shadow).toBe('rgb(255, 255, 255) 2px 0px 0px 0px inset');

  // (2) **光っている行はちょうど1つ。**
  //     マウスを項目2へ動かすと、**選択そのものがそこへ移る**（`onMouseMove` が
  //     `focus()` を移す。macOS のネイティブメニューと同じ挙動）。
  //
  //     **2つの assert は主語が違う。順序を入れ替えないこと。**
  //     - 先の「光っている行が1つ」が赤くなるのは **`:hover` の併記が戻り、かつ
  //       フォーカスが追随しなくなった**とき（フォーカスとポインタが別の行に居座る）。
  //       `:hover` を戻しただけでは**赤くならない**（`onMouseMove` が同じ行へ
  //       フォーカスを移すので、2つの状態が同じ行で重なる）。実測で確認済み
  //     - あとの「選択が乗り移っている」が赤くなるのは **`onMouseMove` を外した**とき
  await items.nth(2).hover();
  expect(
    await menu.evaluate(
      (el) =>
        [...el.querySelectorAll('[role="menuitem"]')].filter(
          (item) => getComputedStyle(item).backgroundColor !== 'rgba(0, 0, 0, 0)',
        ).length,
    ),
  ).toBe(1);
  expect(await items.nth(2).evaluate((el) => el === document.activeElement)).toBe(true);

  // (2-b) **現在項目の塗りが、メニューの枠に接していない。**
  //       枠（--border-control）は端末出力の上で「ここからがメニュー」を運ぶ唯一の情報
  //       なので 1.4.11 の 3:1 が要る。**塗りが接すると 2.65 で割る**（S40 の
  //       「メニューの枠（対メニュー面）」は色しか見ないので、接触を検出できない）。
  //       メニュー側の水平 padding で離してある。⛔ 項目側の margin では離せない
  //       （`width: 100%` の flex アイテムなのでマージンボックスが溢れる）。
  const inset = await menu.evaluate((el) => {
    const menuRect = el.getBoundingClientRect();
    const item = el.querySelector('[role="menuitem"]') as HTMLElement;
    const itemRect = item.getBoundingClientRect();
    const border = Number.parseFloat(getComputedStyle(el).borderLeftWidth);
    return {
      left: itemRect.left - (menuRect.left + border),
      right: menuRect.right - border - itemRect.right,
    };
  });
  expect(inset.left).toBeGreaterThan(0);
  expect(inset.right).toBeGreaterThan(0);

  // (3) `Tab` はメニューを閉じない。しかも1回目は**メニューの中**へ進む。
  //     3項目とも `tabIndex === 0` のままで、APG の roving tabindex が入っていない。
  //     外へ出るのは3回目で、そのときも `aria-expanded="true"` のまま
  //     メニューが端末の上に貼り付いて残る。
  //     ⚠ **直前のホバーで選択が項目2へ移っている**ので、先に矢印で先頭へ戻す
  //       （3項目の循環なので `ArrowDown` 1回で 2 -> 0）。
  await window.keyboard.press('ArrowDown');
  expect(await items.nth(0).evaluate((el) => el === document.activeElement)).toBe(true);
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
