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
 * macOS の信号機ボタンが占める矩形（src/renderer/src/styles.css の
 * `.tab-bar__traffic-light-gap` のコメントに実測の根拠がある）。
 *
 * AppKit の standardWindowButton は 14x14 で、隣り合う原点の間隔は 23px。
 * Electron は `trafficLightPosition`（src/main/index.ts の { x: 16, y: 16 }）を
 * close ボタンの左上として使い、残り2つを同じ間隔で並べ直す。したがって
 * 占有範囲は x: 16 〜 16 + 14 + 23 * 2 = 76、y: 16 〜 16 + 14 = 30。
 *
 * **信号機はネイティブのボタンで DOM に存在しない**ため、Playwright の
 * `boundingBox()` でも `document.elementFromPoint()` でも「信号機そのもの」は
 * 取れない。ここで検査できるのは逆向きの命題 —— この矩形の中に、押しても
 * 信号機に吸われてしまう DOM の操作要素（タブ）が1つも来ていないこと。
 */
const TRAFFIC_LIGHT_RECT = { left: 16, top: 16, right: 76, bottom: 30 } as const;

/**
 * Issue #20 K-1（PR 15「サイドバーの折りたたみ」）。
 *
 * `Cmd+Option+S` でサイドバーを畳む / 戻す。**既定は開いたまま**なので、
 * 既存の spec とスクリーンショットの起点は1つも動かない。
 *
 * この spec が押さえるのは3つ:
 *
 * 1. **キーが実際に発火すること。** `shortcuts.ts` の `passesModifierGate` は
 *    PR 15 まで `Cmd+Option+英字` を丸ごと弾いており、`matchShortcut` 側の
 *    altKey 分岐も矢印キー以外を null にしていた（二重に塞がっていた）。
 *    どちらか片方でも戻すと、ここで畳めなくなる。
 * 2. **本当に幅が 0 になること。** `.sidebar` には `min-width: 220px` があり、
 *    `width: 0` だけでは min-width が勝って 220px のまま残る。
 *    `border-right` を消し忘れると 1px の縦線が残る。
 * 3. **畳んだ結果、信号機ボタンの下にタブが潜り込まないこと。**
 *    サイドバーが持っていた `.sidebar__drag-region`（信号機の下敷き）が
 *    消えるため、逃げ帯（`.tab-bar__traffic-light-gap`）が無いと1枚目のタブが
 *    「見えているのに押せない」領域を抱える。`S69` と同じく
 *    `document.elementFromPoint()` で直接確かめる（幾何を紙で計算して
 *    誤った実例が2件ある。design-rules.md 参照）。
 */
test('S72 Cmd+Option+S でサイドバーを畳み、信号機の下にタブが入らない', async () => {
  const { window } = launched;
  const sidebar = window.locator('.sidebar');
  const gap = window.locator('.tab-bar__traffic-light-gap');
  const tabs = window.locator('.tab-bar__tab');

  // **最初のシェルタブが出るまで待つ。** グローバルショートカットの keydown
  // リスナは App.tsx の useEffect で張られるので、マウント前に押したキーは
  // 取りこぼされる（S55 / S67 / S68 が同じ原因で落ちた前例）。
  await expect(tabs).toHaveCount(1, { timeout: 15_000 });

  // --- 既定は開いたまま（ここが変わると画像13枚と26 spec の起点が動く） -------
  await expect(sidebar).toBeVisible();
  await expect(gap).toHaveCount(0);
  const openWidth = await sidebar.evaluate((el) => el.getBoundingClientRect().width);
  expect(openWidth).toBeGreaterThan(0);
  const mainWidthWhileOpen = await window
    .locator('.main')
    .evaluate((el) => el.getBoundingClientRect().width);

  // --- 畳む -----------------------------------------------------------------
  // `.code` は KeyS。macOS の実機では Option+s の `.key` が `ß` になりうるため
  // shortcuts.ts は `.code` で判定している（S67 が `Cmd+Shift+]` を
  // `BracketRight` で送っているのと同じ理由）。
  await window.keyboard.press('Meta+Alt+s');

  // visibility: hidden なので Playwright からは不可視になる。
  await expect(sidebar).toBeHidden();
  await expect(gap).toHaveCount(1);

  // 幅が本当に 0 か。min-width: 220px の打ち消し漏れ・border-right の
  // 消し忘れは、どちらもここで 0 以外として現れる。
  const collapsed = await sidebar.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return { width: rect.width, borderRight: style.borderRightWidth };
  });
  expect(collapsed.width).toBe(0);
  expect(collapsed.borderRight).toBe('0px');

  // ターミナル側がそのぶん広がっている（畳む目的そのもの）。
  const mainWidthWhileCollapsed = await window
    .locator('.main')
    .evaluate((el) => el.getBoundingClientRect().width);
  expect(mainWidthWhileCollapsed).toBeGreaterThan(mainWidthWhileOpen);

  // --- 信号機の矩形にタブが来ていないこと -----------------------------------
  // 矩形の四隅と中心を走査する。ヒットするのは常に逃げ帯であるべきで、
  // タブ（またはその中の選択用ボタン）に当たったらその点は押しても
  // 信号機に吸われる = 「見えているのに押せない」領域になる。
  const probes = [
    [TRAFFIC_LIGHT_RECT.left, TRAFFIC_LIGHT_RECT.top],
    [TRAFFIC_LIGHT_RECT.right, TRAFFIC_LIGHT_RECT.top],
    [TRAFFIC_LIGHT_RECT.left, TRAFFIC_LIGHT_RECT.bottom],
    [TRAFFIC_LIGHT_RECT.right, TRAFFIC_LIGHT_RECT.bottom],
    [
      (TRAFFIC_LIGHT_RECT.left + TRAFFIC_LIGHT_RECT.right) / 2,
      (TRAFFIC_LIGHT_RECT.top + TRAFFIC_LIGHT_RECT.bottom) / 2,
    ],
  ] as const;

  const hits = await window.evaluate((points) => {
    return points.map(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      if (el === null) return 'none';
      if (el.closest('.tab-bar__tab') !== null) return 'tab';
      if (el.closest('.tab-bar__traffic-light-gap') !== null) return 'gap';
      return el.className || el.tagName;
    });
  }, probes.map(([x, y]) => [x, y] as [number, number]));

  expect(hits, '信号機の矩形の中はすべて逃げ帯であるべき').toEqual([
    'gap',
    'gap',
    'gap',
    'gap',
    'gap',
  ]);

  // 1枚目のタブ自体が、信号機の右端より右から始まっていること
  // （elementFromPoint の走査点は5点だけなので、幾何そのものも直接固定する）。
  const firstTabLeft = await tabs.nth(0).evaluate((el) => el.getBoundingClientRect().left);
  expect(firstTabLeft).toBeGreaterThanOrEqual(TRAFFIC_LIGHT_RECT.right);

  // --- 戻す（トグルであること） ---------------------------------------------
  await window.keyboard.press('Meta+Alt+s');
  await expect(sidebar).toBeVisible();
  await expect(gap).toHaveCount(0);
  const reopenedWidth = await sidebar.evaluate((el) => el.getBoundingClientRect().width);
  expect(reopenedWidth).toBe(openWidth);
});
