import { test, expect, type Page } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

/**
 * Issue #170（Issue #179 の周5）。
 *
 * ## この spec が守るもの
 *
 * 「+ ▾」を押したときに、**メニューが本当に画面に出ていること**。
 *
 * `S64-new-tab-menu.spec.ts` は `toBeVisible()` とキーボード操作を見ているが、
 * **どちらも「見えていない」ことを検出しない**:
 *
 * - **`toBeVisible()` は祖先のクリッピングを見ない**（矩形が空でなく `visibility` が
 *   `hidden` でなければ可視と判定する）
 * - Playwright のクリックは `scrollIntoViewIfNeeded()` を挟むので、**切られていても押せてしまう**
 * - キーボードは開いた瞬間に先頭項目へフォーカスが乗るので、**見えないまま矢印 + Enter で通る**
 *
 * 実際、**関門は4本あって4本とも通っていた**（S06 / S64 / S69 / S78）。
 * 壊れていたのは実装だけでなく、**関門が「見えていること」を1本も見ていなかった**こと。
 *
 * ## 何が起きていたか（2026-08-05 に実機で実測）
 *
 * `.tab-bar__new-menu` は `position: absolute; top: 100%` で、包含ブロックの
 * `.tab-bar__new-wrapper` が **`.tab-bar__tabs`（`overflow-x: auto`）の中**にあった。
 * `overflow-x` が `visible` 以外だと `overflow-y: visible` は **`auto` に計算される**
 * （CSS Overflow 3）ので、36px のスクロールポートの外に出るメニューは両軸で切られる。
 * さらに開いた瞬間の `focus()` が「見えない要素を見せよう」としてコンテナをスクロールさせ、
 * **タブのほうが画面外へ押し出されていた**（`scrollTop: 39.5`）。
 *
 * 原因は3つあり、**入れ子を直すだけでは1つしか消えない**。この spec は3つとも見る。
 *
 * | # | 原因 | このファイルのどの構成が捕まえるか |
 * |---|---|---|
 * | (a) | `.tab-bar__tabs` の縦クリップ | 構成1（タブ1枚） |
 * | (b) | `z-index` が `.notice-list`（20）に負ける | 構成2（通知バナーを1枚出す） |
 * | (c) | `left: 0` + `min-width: 160px` でウィンドウ右端からはみ出す | 構成3（タブ12枚） |
 *
 * ⛔ **中心1点で `elementFromPoint` しない。** 中心はちょうど2番目の項目に当たるので、
 * 上下 1/3 だけが切られる壊れ方を素通しする。**3項目 x 3点 = 9点**で見る。
 *
 * ⛔ **`scrollTop` を読む前に、先頭項目にフォーカスが乗るのを待つ。** スクロールを
 * 起こしているのは `TabBar.tsx` の `useEffect` の `focus()` で、`click()` より後に走る。
 * 待たずに読むと**壊れたビルドでも 0 が返る**。
 */

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

interface MenuProbe {
  /** 9点のうち、メニューの子孫に解決した点の数 */
  hits: number;
  /** 調べた点の総数（3項目 x 3点） */
  total: number;
  /** メニューがウィンドウの矩形に完全に収まっているか */
  insideWindow: boolean;
  /** メニューの矩形（はみ出したときに、どちらへ何 px 出たかを報告に出す） */
  rect: { left: number; top: number; right: number; bottom: number };
  /** ビューポートの大きさ */
  viewport: { width: number; height: number };
  /** 外した点が何に当たったか（デバッグ用。最大3件） */
  blockedBy: string[];
}

/**
 * 開いているメニューの「実際に見えているか」を測る。
 *
 * `getBoundingClientRect()` はクリップされても縮まないので、**矩形ではなく当たり判定**で見る。
 */
async function probeMenu(window: Page): Promise<MenuProbe> {
  return window.evaluate(() => {
    const menu = document.querySelector<HTMLElement>('.tab-bar__new-menu');
    if (!menu) throw new Error('メニューが DOM に無い（開く操作自体が失敗している）');
    const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    if (items.length === 0) throw new Error('メニュー項目が1つも無い');

    const blockedBy: string[] = [];
    let hits = 0;
    let total = 0;
    for (const item of items) {
      const r = item.getBoundingClientRect();
      // 中心と、左上寄り・右下寄りの3点。角ちょうどは隣の要素を拾うので内側へ寄せる。
      const points: Array<[number, number]> = [
        [r.left + r.width / 2, r.top + r.height / 2],
        [r.left + 4, r.top + 2],
        [r.right - 4, r.bottom - 2],
      ];
      for (const [x, y] of points) {
        total += 1;
        const hit = document.elementFromPoint(Math.round(x), Math.round(y));
        if (hit && menu.contains(hit)) {
          hits += 1;
        } else if (blockedBy.length < 3) {
          blockedBy.push(hit ? `${hit.tagName}.${hit.className}` : 'null（ビューポート外）');
        }
      }
    }

    const rect = menu.getBoundingClientRect();
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const insideWindow =
      rect.left >= 0 && rect.top >= 0 && rect.right <= viewport.width && rect.bottom <= viewport.height;

    return {
      hits,
      total,
      insideWindow,
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      viewport,
      blockedBy,
    };
  });
}

/** メニューを開き、先頭項目にフォーカスが乗るまで待つ（`scrollTop` を読む前提を作る）。 */
async function openMenu(window: Page): Promise<void> {
  await window.locator('button[aria-label="新しいタブを開く"]').click();
  const firstItem = window.locator('.tab-bar__new-menu [role="menuitem"]').first();
  await expect(firstItem).toBeAttached();
  await expect
    .poll(() => firstItem.evaluate((el) => el === document.activeElement), { timeout: 5_000 })
    .toBe(true);
}

/** 各構成で同じ検査を通す。`label` は落ちたときにどの構成かを見せるためだけに使う。 */
async function expectMenuIsActuallyVisible(window: Page, label: string): Promise<void> {
  const probe = await probeMenu(window);

  expect(
    probe.hits,
    `${label}: メニュー項目の ${probe.total} 点のうち ${probe.hits} 点しか当たり判定に出ていない。` +
      `祖先の overflow か z-index に負けている（当たったもの: ${probe.blockedBy.join(' / ')}）`,
  ).toBe(probe.total);

  expect(
    probe.insideWindow,
    `${label}: メニューがウィンドウからはみ出している。` +
      `menu=[${Math.round(probe.rect.left)}, ${Math.round(probe.rect.right)}] / ` +
      `viewport=${probe.viewport.width}x${probe.viewport.height}。` +
      `body は overflow: hidden なので、はみ出した分は黙って消える`,
  ).toBe(true);

  // **A を差し戻したときの検知器。** 入れ子が元に戻ると、開いた瞬間の focus() が
  // スクロールコンテナを動かしてタブを押し出す（実測 39.5）。
  // 現在の構造では `scrollHeight === clientHeight` なので、この assert は恒真に近い。
  // それでも残すのは、**恒真でなくなる変更こそが差し戻し**だから。
  const scrollTop = await window.locator('.tab-bar__tabs').evaluate((el) => el.scrollTop);
  expect(scrollTop, `${label}: メニューを開いたらタブが縦にスクロールして押し出された`).toBe(0);
}

async function closeMenu(window: Page): Promise<void> {
  await window.keyboard.press('Escape');
  await expect(window.locator('.tab-bar__new-menu')).toHaveCount(0);
}

test('S95 「+ ▾」のメニューが、タブが溢れていても通知が出ていても実際に画面に出る', async () => {
  const { window } = launched;

  const tabs = window.locator('.tab-bar__tab');
  await expect(tabs).toHaveCount(1, { timeout: 15_000 });

  // --- 構成1: タブ1枚（原因 (a)）-----------------------------------------------
  await openMenu(window);
  await expectMenuIsActuallyVisible(window, 'タブ1枚');

  // 「+ ▾」自身も押せる位置に居ること。A の副次効能（+ がスクロールで消えない）を
  // 守るものが他に1つも無いので、ここで固定する。
  const newButtonHit = await window.evaluate(() => {
    const btn = document.querySelector<HTMLElement>('.tab-bar__new');
    if (!btn) return 'ボタンが無い';
    const r = btn.getBoundingClientRect();
    const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
    return hit && btn.contains(hit) ? 'ok' : `${hit?.tagName}.${hit?.className}`;
  });
  expect(newButtonHit, '「+ ▾」自身が当たり判定に出ていない').toBe('ok');
  await closeMenu(window);

  // --- 構成2: 通知バナーが出ている（原因 (b)）----------------------------------
  //
  // 通知は自動で消えないので、ここで1枚出すと以降ずっと出たままになる。
  // 構成3（タブ12枚）は通知が出た状態のまま走るので、(b) と (c) の複合も見ている。
  await window.keyboard.press('Meta+t');
  await expect(tabs).toHaveCount(2, { timeout: 15_000 });
  const shell = window.locator('.terminal-pane:not(.terminal-pane--hidden) .xterm-screen').first();
  await expect(shell).toContainText(/[$%#>]/, { timeout: 20_000 });
  await window.locator('.terminal-pane:not(.terminal-pane--hidden) .xterm-helper-textarea').focus();
  await window.keyboard.type('exit 7');
  await window.keyboard.press('Enter');
  await expect(window.locator('.notice-banner--error')).toHaveCount(1, { timeout: 15_000 });

  await openMenu(window);
  await expectMenuIsActuallyVisible(window, '通知バナーあり');
  await closeMenu(window);

  // --- 構成3: タブ12枚（原因 (c)）----------------------------------------------
  //
  // タブが溢れると `.tab-bar__drag-region`（flex: 1 / basis 0）の実幅が 0 になり、
  // 「+」は設定ボタンに密着する。メニューを左端揃えにしていると、そこから
  // 160px 伸びてウィンドウの外へ出る（ウィンドウ幅に依存せず必ず起きる）。
  for (let i = 0; i < 10; i += 1) {
    await window.keyboard.press('Meta+t');
  }
  await expect(tabs).toHaveCount(12, { timeout: 20_000 });

  await openMenu(window);
  await expectMenuIsActuallyVisible(window, 'タブ12枚 + 通知バナーあり');
  await closeMenu(window);
});
