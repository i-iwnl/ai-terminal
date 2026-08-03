import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/harness';

/**
 * Issue #119 の周1（関門を先に置く周）。
 *
 * ウィンドウ上端には帯が2本並んでいる（`.sidebar__drag-region` と `.tab-bar`）。
 *
 * **周1 で置いたときは 40px / 36px で、4px の段差があった**（#20 の K-4
 * 「継ぎ目が折れている」）。**周5 で 36 / 36 に揃え、あわせて
 * `trafficLightPosition` を `{ x: 16, y: 11 }` にした。** これで信号機の光学中心
 * （`11 + 14/2 = 18`）・帯の中心（`36/2 = 18`）・タブバーのテキスト中心（18）が
 * 3つとも揃う。
 *
 * **この2つの高さを引く spec は周1 まで1本も無かった。** 40 を 44 に変えても
 * 36 を 40 に変えても、`make e2e` はフル実行で green のまま通っていた
 * （`docs/images/` の12枚が静かに変わるだけで、台帳ハーネスは画像の中身を見ない）。
 * S40 / S70 / S71 と同じ穴で、**帯を動かす前にここを埋めた**のがこの spec の役目。
 * 周1 -> 周5 の期待値の diff（40 -> 36、段差 4 -> 0）がそのままレビュー資料になる。
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
    //
    // **周5（2026-08-03）で 40 / 36 から 36 / 36 に揃えた。** 期待値のこの diff が
    // #20 の K-4「継ぎ目が折れている」を解決した証拠。
    expect(heights.dragRegion, 'サイドバー側の帯（信号機の下敷き）').toBe(36);
    expect(heights.tabBar, 'タブバー').toBe(36);

    expect(
      Math.abs(heights.dragRegion - heights.tabBar),
      '上端の帯の段差（周5 で 4px -> 0 にした）',
    ).toBe(0);

    // **信号機の位置はここでは検査できない。**
    // 信号機はネイティブの `NSButton` で DOM に存在せず、Electron には
    // `trafficLightPosition` を読み戻す API も無い（`getTrafficLightPosition` は
    // Electron 43 に存在しない。この spec で実際に呼んで確認した）。
    // **`if (取れたら) 検査する` という形にすると、API が消えた日から
    // 何も見ていないのに green になる**ので、そう書かないこと。
    // 帯の高さと信号機の y の関係は `src/shared/windowChrome.ts` に導出を集め、
    // `test/unit/css-tokens.test.ts` が CSS の `--bar-height` との一致ごと固定している。

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
