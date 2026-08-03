import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/harness';

/**
 * Issue #119 の周1（関門を先に置く周）。
 *
 * ウィンドウ上端には**高さの違う帯が2本**並んでいる。
 *
 * - `.sidebar__drag-region` … 40px（信号機ボタンの下敷き）
 * - `.tab-bar` … 36px
 *
 * この 4px の段差は #20 の K-4 が「継ぎ目が折れている」として指摘したもので、
 * #119 の周5（PR 20）で揃える予定になっている。
 *
 * **問題は、この2つの高さを引く spec が1本も無いこと。** 40 を 44 に変えても
 * 36 を 40 に変えても、`make e2e` はフル実行で green のまま通る（`docs/images/`
 * の12枚が静かに変わるだけで、台帳ハーネスは画像の中身を見ない）。
 * これは S40 / S70 / S71 と同じ穴で、**周5 で帯を動かす前にここを埋める**のが
 * この spec の役目。
 *
 * したがってここは characterization（現状の値をそのまま固定する）であって、
 * 「正しい値」を主張するものではない。周5 で 36 / 36 に揃えるとき、
 * **この spec の期待値の diff がそのままレビュー資料になる。**
 *
 * あわせて `--bar-height` トークンが実際に効いていることも見る。
 * `.tab-bar` の高さと `.notice-list` の `top` は以前どちらも `36px` の
 * リテラルで、片方だけ動かすと**通知バナーがタブバーに被って、キーボードで
 * フォーカス中のタブが完全に隠れる**（WCAG 2.4.11 Focus Not Obscured, AA）。
 * CSS の記述そのものは test/unit/css-tokens.test.ts が見ているので、
 * ここでは「トークンを動かすと本当に描画が追従するか」を見る
 * （宣言があっても別の規則に負けていれば効かない）。
 */
test('S73 ウィンドウ上端の2本の帯の高さが、意図した値で固定されている', async () => {
  const launched = await launchApp();
  try {
    const { window } = launched;

    const screen = window.locator('.terminal-pane__container .xterm-screen').first();
    await expect(screen).toContainText(/[$%#>]/, { timeout: 20_000 });

    // --- 現状の高さを固定する（周5 で揃えるときに diff が出る） ----------------
    const heights = await window.evaluate(() => {
      const read = (selector: string): number => {
        const el = document.querySelector(selector);
        if (!el) return -1;
        return el.getBoundingClientRect().height;
      };
      return {
        dragRegion: read('.sidebar__drag-region'),
        tabBar: read('.tab-bar'),
      };
    });

    // 紙で計算せず、実際に描かれた矩形を測る（design-rules「要素の実寸を
    // 主張するなら getBoundingClientRect() で測る」）。
    expect(heights.dragRegion, 'サイドバー側の帯（信号機の下敷き）').toBe(40);
    expect(heights.tabBar, 'タブバー').toBe(36);

    // **この2つが揃っていないことを、ここで明示的に記録しておく。**
    // 周5 でこの行が `toBe(0)` に変わるのが、K-4 が解決した証拠になる。
    expect(
      Math.abs(heights.dragRegion - heights.tabBar),
      '上端の帯の段差（Issue #119 周5 で 0 にする）',
    ).toBe(4);

    // --- --bar-height が実際に描画へ効いている --------------------------------
    // 宣言されているだけで別の規則に負けている、を排除する。
    const followsToken = await window.evaluate(() => {
      const tabBar = document.querySelector('.tab-bar');
      if (!tabBar) return null;
      const root = document.documentElement;
      const before = tabBar.getBoundingClientRect().height;
      root.style.setProperty('--bar-height', '52px');
      const after = tabBar.getBoundingClientRect().height;
      root.style.removeProperty('--bar-height');
      const restored = tabBar.getBoundingClientRect().height;
      return { before, after, restored };
    });

    expect(followsToken, '.tab-bar が見つからない').not.toBeNull();
    expect(followsToken?.after, '--bar-height を変えたらタブバーが追従する').toBe(52);
    expect(followsToken?.restored, 'トークンを戻したら元の高さに戻る').toBe(36);
  } finally {
    await closeApp(launched);
  }
});
