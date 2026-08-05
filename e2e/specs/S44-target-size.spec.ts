import { test, expect, type Locator } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

interface HitAreaResult {
  width: number;
  height: number;
  hitsAtCorners: boolean;
}

/**
 * 当たり判定（実際にクリックを受ける矩形）を測る。
 *
 * ボタン本体は見た目を変えないために小さいままなので、Playwright の
 * boundingBox() では WCAG 2.2 の 2.5.8（24x24 CSS px）を満たしているか判定
 * できない。styles.css は ::before の透明な疑似要素で当たり判定だけを
 * 広げているため、getComputedStyle(el, '::before') で疑似要素の実寸（px に
 * 解決済みの used value）を読む。
 *
 * サイズを読むだけでは「疑似要素は 24x24 あるのに、別の要素に覆われて
 * 実際にはクリックが通らない」揺り戻しを見逃すため、矩形の四隅
 * （境界のちょうど際は丸めで外れうるので 0.5px 内側）を
 * document.elementFromPoint で実際にヒットテストし、ボタン自身（かその
 * 子孫）に当たることまで確認する。
 */
async function measureHitArea(button: Locator): Promise<HitAreaResult> {
  return button.evaluate((el) => {
    const before = getComputedStyle(el, '::before');
    const width = Number.parseFloat(before.width);
    const height = Number.parseFloat(before.height);
    // ::before 自体が無い（content: none のまま）と width/height は "auto" になり
    // parseFloat が NaN を返す。elementFromPoint に NaN 座標を渡すと例外になるので、
    // ここで打ち切って「幅・高さ 0、当たらない」という明確な失敗として返す
    // （見た目の変更前のコードを試すと実際にこの分岐を通る）。
    if (Number.isNaN(width) || Number.isNaN(height)) {
      return { width: 0, height: 0, hitsAtCorners: false };
    }
    const rect = el.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const inset = 0.5;
    const corners: Array<[number, number]> = [
      [centerX - width / 2 + inset, centerY - height / 2 + inset],
      [centerX + width / 2 - inset, centerY - height / 2 + inset],
      [centerX - width / 2 + inset, centerY + height / 2 - inset],
      [centerX + width / 2 - inset, centerY + height / 2 - inset],
    ];
    const hitsAtCorners = corners.every(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return hit !== null && (hit === el || el.contains(hit));
    });
    return { width, height, hitsAtCorners };
  });
}

function expectAtLeast24(result: HitAreaResult, label: string): void {
  expect(result.width, `${label}: 当たり判定の幅`).toBeGreaterThanOrEqual(24);
  expect(result.height, `${label}: 当たり判定の高さ`).toBeGreaterThanOrEqual(24);
  expect(result.hitsAtCorners, `${label}: 当たり判定の四隅で実際にクリックが当たる`).toBe(true);
}

/**
 * Issue #20 の調査で 24x24 を割っていた7種類のうち、実際にクリックできる
 * ボタンとして今も画面に存在する6種類を測る（設定の閉じるボタンは #25 で
 * 設定が独立ウィンドウ化された際に画面上のボタンごと無くなり、Escape /
 * Cmd+W / OS のクローズボタンだけになっているため対象が消滅している）。
 */
test('S44 小さいボタンの当たり判定が 24x24 CSS px 以上ある', async () => {
  const { window } = launched;

  // 1) タブの閉じるボタン。
  //    1枚目のまま閉じるとタブが0枚になり、自動で新しいシェルが開く挙動
  //    （S08）を誘発してしまうので、2枚目を開いてからそちらの閉じるボタンを測る。
  // 直接の子孫（>）ではなく子孫セレクタにする。role="tablist" 化（Issue #20 PR 9）で
  // タブは .tab-bar__tabs > .tab-bar__tablist > .tab-bar__tab の3階層になったため。
  const tabs = window.locator('.tab-bar__tab');
  await expect(tabs).toHaveCount(1);
  await window.keyboard.press('Meta+t');
  await expect(tabs).toHaveCount(2);
  expectAtLeast24(await measureHitArea(tabs.nth(1).locator('.tab-bar__close')), 'タブの閉じる');

  // Issue #120 B-2（周3）: 24x24 を満たしているだけでは足りない。
  //
  // 広げた当たり判定がすぐ隣のクリック対象へ食い込むと、**押し間違いの結果が
  // 「タブを選ぶ」ではなく「タブを閉じる」になる**（走行中のエージェントを見失う）。
  // 周3 の実測では、見た目 14x14 のボタンに対し ::before の 24x24 が左右へ
  // 5px ずつはみ出し、**右の 5px が `.tab-bar__tab-button` の padding-left の中**に
  // 乗っていた（タイトル文字まであと 3px）。
  //
  // 直したあとの契約は「**当たり判定の右端が、ボタンの箱の右端を越えない**」。
  // サイズや ::before の実装（中央寄せか片寄せか）に依らず falsifiable にするため、
  // computed style ではなく elementFromPoint で実際に確かめる。
  // 上下のはみ出しは意図的に残している（そこは「閉じるを狙って縦に外した」
  // 位置で、押した結果は狙いと一致する。害があるのは隣のターゲットへ
  // 向かう向きだけ）。
  const closeOverhang = await tabs.nth(1).evaluate((tab) => {
    const close = tab.querySelector('.tab-bar__close') as HTMLElement;
    const rect = close.getBoundingClientRect();
    const centerY = rect.top + rect.height / 2;
    const hitsClose = (x: number): boolean => {
      const hit = document.elementFromPoint(x, centerY);
      return hit !== null && (hit === close || close.contains(hit));
    };
    // 右へ 1px ずつ 12px ぶん見て、閉じるボタンに当たる点を全部集める。
    const overhangingX: number[] = [];
    for (let dx = 1; dx <= 12; dx += 1) {
      if (hitsClose(rect.right + dx)) overhangingX.push(dx);
    }
    return {
      overhangingX,
      // 箱の内側（右端の 0.5px 手前）はちゃんと当たること。ここが false だと
      // 上の「はみ出し 0」は「そもそもどこにも当たらない」で成立してしまう。
      hitsJustInside: hitsClose(rect.right - 0.5),
    };
  });
  expect(
    closeOverhang.hitsJustInside,
    'タブの閉じる: 箱の右端の内側では当たり判定が生きている',
  ).toBe(true);
  expect(
    closeOverhang.overhangingX,
    'タブの閉じる: 当たり判定がタブ選択の側（右）へ 1px も食い込まない',
  ).toEqual([]);

  // 2) 検索の「前」「次」「x」ボタン。
  const screen = window.locator('.terminal-pane__container .xterm-screen').first();
  await expect(screen).toContainText(/[$%#>]/, { timeout: 20_000 });
  await window.locator('.xterm-helper-textarea').first().focus();
  await window.keyboard.press('Meta+f');
  await expect(window.locator('.terminal-search')).toBeVisible();
  expectAtLeast24(
    await measureHitArea(window.locator('.terminal-search button[title="前を検索"]')),
    '検索の「前」',
  );
  expectAtLeast24(
    await measureHitArea(window.locator('.terminal-search button[title="次を検索"]')),
    '検索の「次」',
  );
  const searchCloseButton = window.locator('.terminal-search button[title="検索を閉じる"]');
  expectAtLeast24(await measureHitArea(searchCloseButton), '検索の「x」');
  await searchCloseButton.click();
  await expect(window.locator('.terminal-search')).toBeHidden();

  // 3) 履歴のプロバイダ切替（Claude / Gemini）と更新ボタン。
  await window.locator('.sidebar__tabs button', { hasText: '履歴' }).click();
  const items = window.locator('.history-item');
  await expect(items).toHaveCount(3);

  const providerButtons = window.locator('.history-list__providers button');
  await expect(providerButtons).toHaveCount(2);
  expectAtLeast24(await measureHitArea(providerButtons.nth(0)), '履歴のプロバイダ切替（Claude）');
  expectAtLeast24(await measureHitArea(providerButtons.nth(1)), '履歴のプロバイダ切替（Gemini）');
  expectAtLeast24(await measureHitArea(window.locator('.history-list__reload')), '履歴の更新');

  // 4) 履歴の「メモ」「編集」ボタン。普段は opacity:0 で隠れており、行を hover すると見える。
  const target = items.nth(2);
  await target.hover();
  const memoButton = target.locator('button[aria-label="メモを開く"]');
  const editButton = target.locator('button[aria-label="タイトルを編集"]');
  await expect(memoButton).toBeVisible();
  expectAtLeast24(await measureHitArea(memoButton), '履歴の「メモ」');
  expectAtLeast24(await measureHitArea(editButton), '履歴の「編集」');

  // 隣接する2つの当たり判定が重ならないこと。重なると押し間違いが増え、
  // 直す前より悪くなる（当たり判定を広げるときに最も注意すべき失敗モード）。
  const overlap = await window.evaluate(
    ([memoSelector, editSelector]) => {
      const measure = (el: Element) => {
        const before = getComputedStyle(el, '::before');
        const rect = el.getBoundingClientRect();
        return {
          centerX: rect.left + rect.width / 2,
          width: Number.parseFloat(before.width),
        };
      };
      const items = document.querySelectorAll('.history-item');
      const row = items[2] as HTMLElement;
      const memoEl = row.querySelector(memoSelector) as HTMLElement;
      const editEl = row.querySelector(editSelector) as HTMLElement;
      const memo = measure(memoEl);
      const edit = measure(editEl);
      return {
        memoRight: memo.centerX + memo.width / 2,
        editLeft: edit.centerX - edit.width / 2,
      };
    },
    ['button[aria-label="メモを開く"]', 'button[aria-label="タイトルを編集"]'] as const,
  );
  expect(overlap.memoRight, '「メモ」の当たり判定の右端が「編集」の左端を越えない').toBeLessThanOrEqual(
    overlap.editLeft,
  );

  // 5) メモの閉じるボタン。
  await memoButton.click();
  const sessionCloseButton = window.locator('button[aria-label="セッションメモを閉じる"]');
  await expect(sessionCloseButton).toBeVisible();
  expectAtLeast24(await measureHitArea(sessionCloseButton), 'メモの閉じる');
  await sessionCloseButton.click();

  // 6) 通知バナーの閉じるボタン。
  //    実際のアプリでは node-pty の spawn が、macOS ではコマンド不在・cwd 不正の
  //    どちらでも同期的に例外を投げず PTY 起動後に非同期で exit するだけなので
  //    （S11 のコメント参照）、既存のハーネスには spawn 失敗由来の notice-banner を
  //    実際のユーザー操作から再現する手段が無い（PTY の正常終了/異常終了からは
  //    再現できるが、それは e2e/specs/S55-notice-severity.spec.ts の担当）。
  //    ここでは実マークアップと同じ構造を一時的に body へ差し込み、
  //    同じスタイルシートの下で当たり判定だけを測る
  //    （e2e/fixtures/contrast.ts の againstColor 用プローブ要素と同じ手法。
  //    トリガー経路そのものの検証ではなく、CSS ルールの検証であることに注意）。
  //    Issue #20 PR 11 で位置決めの absolute が `.notice-banner` 自身から
  //    親の `.notice-list` に移った。`.notice-list` を持たず `.notice-banner` だけを
  //    body 直下に置くと、position: static のまま `.app`（100vh）の下に
  //    流れて画面外に出てしまい、measureHitArea の elementFromPoint が
  //    そこでは何にも当たらず false を返す。実マークアップと同じ入れ子
  //    （.notice-list > .notice-banner）で差し込み、位置決めを再現する。
  await window.evaluate(() => {
    const list = document.createElement('div');
    list.className = 'notice-list';
    const banner = document.createElement('div');
    banner.className = 'notice-banner notice-banner--info';
    banner.innerHTML =
      '<span class="notice-banner__icon" aria-hidden="true">i</span>' +
      '<span class="notice-banner__label">情報</span>' +
      '<span class="notice-banner__message">E2E-PROBE</span>' +
      '<button aria-label="閉じる" title="閉じる">x</button>';
    list.appendChild(banner);
    document.body.appendChild(list);
  });
  const noticeCloseButton = window.locator('.notice-banner button');
  await expect(noticeCloseButton).toBeVisible();
  expectAtLeast24(await measureHitArea(noticeCloseButton), '通知バナーの閉じる');
  await window.evaluate(() => document.querySelector('.notice-list')?.remove());

  // 7) 「+ ▾」メニューの項目（Issue #180 引き継ぎ周5-b）。
  //
  //    ⛔ **measureHitArea は使えない。** あれは `::before` で当たり判定を広げている
  //    ボタン専用（`content: none` だと `width: auto` -> NaN -> 無条件 fail を返す）。
  //    メニュー項目は**箱そのものが当たり判定**なので、矩形を直接測る。
  //
  //    **固定するのは「24 以上」だけではなく「3項目の高さが等しい」。**
  //    紙で計算した高さは当てにならない（実測すると 34 / 30 / 30 とバラついていた）。
  //    原因は `font: inherit` が `line-height: normal` を持ち込み、
  //    **日本語ラベルだけフォントフォールバックで行送りが 1.5em になる**こと。
  //    ⛔ `min-height` では「等しい」を保証できない（ラベルを変えれば破れる）ので、
  //    `line-height` の明示が唯一の直し方。**この不変条件はラベル文字列に依存しない。**
  await window.locator('button[aria-label="新しいタブを開く"]').click();
  const menuItems = window.locator('.tab-bar__new-menu-item');
  await expect(menuItems).toHaveCount(3);

  const menuItemBoxes = await window.evaluate(() =>
    [...document.querySelectorAll('.tab-bar__new-menu-item')].map((el) => {
      const rect = el.getBoundingClientRect();
      // **角丸のぶんだけ内側を突く。** 現在項目のハイライトは角丸（--radius-md）なので、
      // 矩形の隅ちょうどは**円の外**に落ちて親（メニュー面）に当たる。
      // 0.5px 固定のままだと「当たらない」と報告されるが、それは当たり判定の
      // 不足ではなく**測り方が角丸を見ていない**だけ（面積の欠けは 3px 角で 2px^2 弱）。
      const radius = Number.parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
      const inset = radius + 0.5;
      const corners: Array<[number, number]> = [
        [rect.left + inset, rect.top + inset],
        [rect.right - inset, rect.top + inset],
        [rect.left + inset, rect.bottom - inset],
        [rect.right - inset, rect.bottom - inset],
      ];
      return {
        label: el.textContent ?? '',
        width: rect.width,
        height: rect.height,
        hitsAtCorners: corners.every(([x, y]) => {
          const hit = document.elementFromPoint(x, y);
          return hit !== null && (hit === el || el.contains(hit));
        }),
      };
    }),
  );

  for (const box of menuItemBoxes) {
    expectAtLeast24(box, `メニュー項目「${box.label}」`);
  }
  expect(
    new Set(menuItemBoxes.map((b) => b.height)).size,
    'メニュー項目の高さが揃っていない（line-height が効いていない）',
  ).toBe(1);

  await window.keyboard.press('Escape');
});
