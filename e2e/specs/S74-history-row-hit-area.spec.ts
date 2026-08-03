import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/harness';

/**
 * Issue #119 の周1（関門を先に置く周）。周2（履歴行の幅の回復）の関門。
 *
 * ## 何を守るか
 *
 * 履歴行は「行全体が resume のボタン（`.history-item__row`）」で、その隣に
 * 「メモ」「編集」という別のインタラクティブ要素（`.history-item__action`）が
 * 並んでいる。後者は `opacity: 0` で普段は見えない。
 *
 * 周2 では `.history-item__actions` をフローから外して（`position: absolute`）
 * 行の実効幅を回復させる。**そのとき、見えないボタンがタイトルの上に浮く。**
 *
 * `opacity: 0` は3つの性質を持つ:
 *
 * 1. レイアウトから外れない（周2 が直そうとしているのはこれ）
 * 2. アクセシビリティツリーに残る
 * 3. **ポインタイベントを止めない**
 *
 * 3 を忘れると、**タイトルの右端をクリックしたときに resume ではなく
 * 「編集」が発火する。** `.tab-bar__close` は同じ失敗モードを
 * `pointer-events: none` で潰しており、その規則のコメントに
 * 「`opacity` だけで隠すと、非表示のあいだも当たり判定が反応してしまい、
 * 常時表示していた頃と実害が変わらない」と明記されている。
 * **同じ規則が `.history-item__action` には適用されていない。**
 *
 * ## なぜ既存の spec では足りないか
 *
 * - `S44-target-size.spec.ts` は「小さいボタン**自身**が 24x24 以上あるか」と
 *   「隣接する当たり判定同士が重ならないか」を見る。**大きい要素の内側に
 *   死角ができることは検出しない**（PR 19 でタブの中央が死角になった件と同型）。
 * - `S19` は履歴行の**中央**をクリックする。右端は撃たない。
 * - `S69-tab-select-center.spec.ts` が同じ観点をタブバーで見ており、
 *   この spec はその履歴行版。
 *
 * ## この spec の現状（2026-08-03 の実測）
 *
 * ```
 * .sidebar               260 x 800
 * .history-item          259 x 94   (x=0,   y=170)
 * .history-item__row     139 x 77   (x=12,  y=178)   <- 周2 で 235px 近くまで回復させる
 * .history-item__actions  88 x 21   (x=159, y=178)
 * .history-item__action   40 x 21   ::before 38 x 24
 * ```
 *
 * **`::before`（24px）の下端は y=200.5、`.history-item__meta` の上端は y=201.5 で、
 * 現状は食い込んでいない**（1px の余裕）。周2 で行の高さや余白を動かすと、
 * この 1px が消えて meta が押せなくなりうるので、そこもここで見る。
 */
test('S74 履歴行のタイトルは、右端までクリックが resume に届く', async () => {
  const launched = await launchApp();
  try {
    const { window } = launched;

    const screen = window.locator('.terminal-pane__container .xterm-screen').first();
    await expect(screen).toContainText(/[$%#>]/, { timeout: 20_000 });

    await window.locator('.sidebar__tabs button', { hasText: '履歴' }).click();
    const items = window.locator('.history-item');
    await expect(items).toHaveCount(3, { timeout: 15_000 });

    // 直前のクリックでカーソルが行の上に残っていると `:hover` が効いてしまい、
    // 「見えていないボタンが当たるか」ではなく「見えているボタンが当たるか」を
    // 測ることになる。サイドバーから離れた場所へ動かしてから測る
    // （S69 が同じ理由で `mouse.move` している）。
    await window.mouse.move(600, 600);

    const probe = await window.evaluate(() => {
      const item = document.querySelector('.history-item');
      if (!item) return null;
      const row = item.querySelector('.history-item__row');
      const title = item.querySelector('.history-item__title');
      const meta = item.querySelector('.history-item__meta');
      const actions = item.querySelector('.history-item__actions');
      const action = item.querySelector('.history-item__action');
      if (!row || !title || !meta || !actions || !action) return null;

      const titleRect = title.getBoundingClientRect();
      const metaRect = meta.getBoundingClientRect();
      const actionRect = action.getBoundingClientRect();
      const before = getComputedStyle(action, '::before');
      const beforeH = Number.parseFloat(before.height);

      /** 与えた点が `.history-item__row`（= resume）に解決するか */
      const hitsRow = (x: number, y: number): boolean => {
        const el = document.elementFromPoint(x, y);
        return el !== null && el.closest('.history-item__row') !== null;
      };

      // タイトルの矩形を左端から右端まで等間隔に撃つ。**右端の際は丸めで
      // 外れうるので 0.5px 内側**（S44 が同じ inset を使っている）。
      const y = titleRect.top + titleRect.height / 2;
      const samples = 9;
      const missed: number[] = [];
      for (let i = 0; i < samples; i += 1) {
        const x = titleRect.left + 0.5 + ((titleRect.width - 1) * i) / (samples - 1);
        if (!hitsRow(x, y)) missed.push(Number(x.toFixed(1)));
      }

      return {
        rowWidth: Number(row.getBoundingClientRect().width.toFixed(1)),
        actionsWidth: Number(actions.getBoundingClientRect().width.toFixed(1)),
        titleWidth: Number(titleRect.width.toFixed(1)),
        missedX: missed,
        // `::before` の下端と meta の上端の隙間（負なら食い込んでいる）
        beforeToMetaGap: Number(
          (metaRect.top - (actionRect.top + actionRect.height / 2 + beforeH / 2)).toFixed(1),
        ),
        // meta の左上が meta 自身（かその子）に当たるか
        metaTopHitsRow: hitsRow(metaRect.left + 2, metaRect.top + 2),
      };
    });

    expect(probe, '履歴行の要素が揃っていない').not.toBeNull();
    if (!probe) return;

    // --- 本命の関門 -----------------------------------------------------------
    // 周2 で `.history-item__actions` を絶対配置にしたとき、
    // `pointer-events: none` を入れ忘れると**ここが赤くなる**。
    expect(
      probe.missedX,
      'タイトルの帯の上でクリックが resume に届かない x 座標があってはならない',
    ).toEqual([]);

    // --- meta が押せなくなっていない -------------------------------------------
    // `::before`（24px の当たり判定）が下の行へ食い込むと、meta の上端が
    // 「メモ」ボタンに奪われる。現状は 1px の余裕しかない。
    expect(
      probe.beforeToMetaGap,
      'メモ/編集の当たり判定が meta の行へ食い込んでいる',
    ).toBeGreaterThanOrEqual(0);
    expect(probe.metaTopHitsRow, 'meta の左上は行（resume）に当たるべき').toBe(true);

    // --- 幅を固定する（characterization） ---------------------------------------
    //
    // **周2（2026-08-03）で 139 -> 235 に回復した。**
    //
    // ```
    // 260(サイドバー) − 1(border-right) − 12×2(.history-item の padding) = 235
    // ```
    //
    // つまり行はサイドバーの内寸をすべて使えるようになった。以前は
    // `.history-item__actions`（88px + gap 8px）がフレックスの行を占有しており、
    // **見えていないボタンがサイドバーの内寸の 41% を予約していた。**
    //
    // 期待値は消さずに更新すること。この diff がレビュー資料になる。
    expect(probe.rowWidth, '.history-item__row の実効幅').toBe(235);
    // 絶対配置になったのでフローの幅は食わないが、**出ているあいだはタイトルに
    // 重なる**帯の幅としてまだ意味がある（88px + padding-left 8px）。
    expect(probe.actionsWidth, '.history-item__actions がホバー時に覆う幅').toBe(96);
  } finally {
    await closeApp(launched);
  }
});
