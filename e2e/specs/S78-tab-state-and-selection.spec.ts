import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/harness';
import { contrastRatio } from '../../src/shared/theme';

/**
 * Issue #119 の周5。タブバーの2つの状態表現。
 *
 * ## 1. 選択中タブの手がかり（#20 の Phase 1 積み残し P0）
 *
 * `.tab-bar__tab.is-active` は**塗りだけ**で選択を表しており、
 * `--surface-tab-active` #2e2e2e はタブバーの面に対し **1.23** しかない
 * （`S40-contrast-contract.spec.ts` が `wcag: 'fail'` として実測固定している。
 * Phase 1 で唯一 3:1 に届かなかった箇所）。**塗りをどう選んでも届かない**
 * （明るくするとタブの文字が読めなくなる）ので、構造で解くしかない。
 *
 * 周5 で白（`--focus-ring`）の下辺 2px を `box-shadow: inset` で足した。
 *
 * - **白である理由**: アクセントも `--border-control` も `prefers-contrast: more` の
 *   面（#525252）で 2.84 / 1.82 まで落ち、**高コントラストモードの利用者だけが
 *   手がかりを失う**。白は 13.58 / 7.81 で、1〜3型の色覚シミュレーションでも
 *   比が動かない
 * - **下辺のみである理由**: フォーカスリングが4辺白なので、選択状態も4辺白にすると
 *   **フォーカスの有無が区別できなくなる**（WCAG 2.4.13）
 * - **`box-shadow: inset` である理由**: `border` は実寸を変えてタブの高さを動かす。
 *   外向きの影は `.tab-bar__tabs` の `overflow-x: auto` に端で切られる
 *
 * **S40 では測れない。** `measureContrast()` は `getComputedStyle` の単一プロパティを
 * 色として解決する実装で、`box-shadow`（`rgb(...) 0px -2px 0px 0px inset`）は
 * 色以外の成分を持つため渡せない。ここで文字列から色を取り出して比を計算する
 * （式は `src/shared/theme.ts` の `contrastRatio` = S40 と同じもの）。
 *
 * ## 2. 「あなたの番」の状態スロット（#20 の B-3）
 *
 * `.tab-bar__state-slot`（6px）は PR #108 で**幅だけ確保されて空のまま**で、
 * CSS のコメント自身が「配線は別 PR」と書いていた。判定関数
 * （`tabYourTurn.ts` の `tabHasYourTurn`）もデータ（`lib/agentTasksStore.ts`）も
 * 既にあり、**唯一の利用者が `Cmd+J` だけ**という状態だった。
 *
 * > **ドットが「出る」側は S89 が見る。この spec は「出ない側」を担当する。**
 * > かつてここには「E2E では検証できない。解くのは #120 D-2（動的フィクスチャ）」と
 * > 書いてあったが、**その D-2 は実装済み**（`setAgentEntries()`）で、記述が
 * > 古くなっていた（#160 の周6 で是正）。この spec 自体は `setAgentEntries()` を
 * > 呼ばないので、**固定 `agents.json` の `sessionId` と実タブの `agentSessionId` は
 * > 一致せず、ドットが出ないのが正しい**という結論は変わらない。
 * > 出る条件そのものは `test/unit/tab-your-turn.test.ts` が固定している。
 */
test('S78 選択中タブに白い下辺の手がかりがあり、状態スロットが色だけに頼らない', async () => {
  const launched = await launchApp();
  try {
    const { window } = launched;

    const screen = window.locator('.terminal-pane__container .xterm-screen').first();
    await expect(screen).toContainText(/[$%#>]/, { timeout: 20_000 });

    // --- 1. 選択中タブの下辺 ---------------------------------------------------
    const active = await window.evaluate(() => {
      const tab = document.querySelector('.tab-bar__tab.is-active');
      const bar = document.querySelector('.tab-bar');
      if (!tab || !bar) return null;
      const cs = getComputedStyle(tab);
      return {
        boxShadow: cs.boxShadow,
        tabBg: cs.backgroundColor,
        barBg: getComputedStyle(bar).backgroundColor,
      };
    });

    expect(active, '選択中のタブが見つからない').not.toBeNull();
    if (!active) return;

    // `rgb(255, 255, 255) 0px -2px 0px 0px inset` のような文字列から色と形を取る。
    expect(active.boxShadow, '選択中タブに inset の影が無い').toContain('inset');
    // **下辺のみであること**（4辺だと フォーカスリングと区別できなくなる）。
    // 2つ目の長さ（y オフセット）が負で、ぼかしと広がりが 0。
    expect(active.boxShadow, '下辺 2px の実線であること').toMatch(/0px -2px 0px 0px/);

    const rgbToHex = (rgb: string): string => {
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb);
      if (!m) return '#000000';
      return `#${[m[1], m[2], m[3]]
        .map((v) => Number(v).toString(16).padStart(2, '0'))
        .join('')}`;
    };

    const lineColor = rgbToHex(active.boxShadow);
    // フォーカスリングと同じ白。**色相を持つ色にしない**（`prefers-contrast: more` の
    // 面で落ちるうえ、色覚特性下で比が動く）。
    expect(lineColor, '線の色は --focus-ring（白）であるべき').toBe('#ffffff');

    // 線が乗っている面（タブ自身の塗り）に対して 3:1 を満たすこと。
    // **これが Phase 1 で唯一 3:1 に届かなかった箇所の答え**（塗り 1.23 の代わりに
    // 構造の手がかりが 3:1 を満たす）。
    const againstTab = contrastRatio(lineColor, rgbToHex(active.tabBg));
    const againstBar = contrastRatio(lineColor, rgbToHex(active.barBg));
    expect(againstTab, '線 対 タブの塗り').toBeGreaterThanOrEqual(3);
    expect(againstBar, '線 対 タブバーの面').toBeGreaterThanOrEqual(3);

    // --- 2. 非選択タブには線が無い（線が「選択状態」を表していること） -----------
    // 2枚目を開いて1枚目を非選択にする。
    await window.locator('.tab-bar__new').click();
    await window.locator('.tab-bar__new-menu-item', { hasText: 'シェル' }).click();
    await expect(window.locator('.tab-bar__tab')).toHaveCount(2, { timeout: 15_000 });

    const inactiveShadow = await window
      .locator('.tab-bar__tab:not(.is-active)')
      .first()
      .evaluate((el) => getComputedStyle(el).boxShadow);
    expect(inactiveShadow, '非選択タブに線が出ていてはいけない').not.toContain('inset');

    // --- 3. 状態スロット -------------------------------------------------------
    // この spec は `setAgentEntries()` を呼ばないので、固定 agents.json の
    // sessionId は実タブの agentSessionId と一致せず、**ドットは出ない**のが正しい
    // （上のコメント参照。出る側は S89）。
    const slots = await window.evaluate(() => {
      const all = [...document.querySelectorAll('.tab-bar__state-slot')];
      return {
        count: all.length,
        yourTurn: all.filter((el) => el.classList.contains('tab-bar__state-slot--your-turn')).length,
        // 幅は常に確保されている（状態が現れてもタブ幅が動かない）。
        widths: all.map((el) => Math.round(el.getBoundingClientRect().width)),
      };
    });
    expect(slots.count, 'すべてのタブがスロットを持つ').toBe(2);
    expect(slots.yourTurn, 'このフィクスチャでは「あなたの番」は出ない').toBe(0);
    expect(slots.widths, 'スロットは常に幅を確保している').toEqual([6, 6]);

    // 出す仕組みが組まれていること: 「あなたの番」の見た目が
    // 終了マークと**形で**区別されている（原則2: 色相の違いは手がかりに数えない）。
    const shapes = await window.evaluate(() => {
      const probe = document.createElement('span');
      document.body.appendChild(probe);
      const read = (cls: string) => {
        probe.className = `tab-bar__state-slot ${cls}`;
        const cs = getComputedStyle(probe);
        return { radius: cs.borderRadius, bg: cs.backgroundColor };
      };
      const yourTurn = read('tab-bar__state-slot--your-turn');
      const exited = read('tab-bar__state-slot--exited');
      probe.remove();
      return { yourTurn, exited };
    });

    // あなたの番は丸、終了は四角。**色を抜いても区別できる。**
    expect(shapes.yourTurn.radius, 'あなたの番は丸').toBe('50%');
    expect(shapes.exited.radius, '終了は角のある四角').not.toBe('50%');
    expect(shapes.yourTurn.bg).not.toBe(shapes.exited.bg);


    // --- Issue #179 周2.5: 選択中 × フォーカス中の下辺 -----------------------------
    //
    // `.tab-bar__tab-button:focus-visible` の `outline-offset` を -2px から -4px にした
    // （帯とフォーカスリングを引き離すため。S41 が隙間を測っている）。
    // **その副作用として、選択中かつフォーカス中のタブは下辺が白 4px の塊になる。**
    // リングの下辺が下から 2〜4px に来て、選択線（下から 0〜2px）と接するため。
    //
    // 承知して受けた変更なので、**事実として固定しておく**（黙って変わらないように）。
    // なお -2px のときはリングの下辺と選択線が**完全に重なっていた**ので、
    // 「選択は下辺のみ・フォーカスは4辺」という面積差での区別は、下辺については
    // 元々付いていなかった（新たに失われるわけではない。左右と上の3辺で保たれる）。
    await window.locator('.tab-bar__new').focus();
    await window.keyboard.press('Shift+Tab');

    const bottomEdge = await window.evaluate(() => {
      const button = document.querySelector('.tab-bar__tab-button:focus-visible');
      if (!button) return null;
      const tab = button.closest('.tab-bar__tab');
      if (!tab) return null;
      const bs = getComputedStyle(button);
      return {
        isActive: tab.classList.contains('is-active'),
        outlineOffset: Number.parseFloat(bs.outlineOffset),
        outlineWidth: Number.parseFloat(bs.outlineWidth),
        selectionShadow: getComputedStyle(tab).boxShadow,
      };
    });

    expect(bottomEdge, 'Shift+Tab でタブのボタンが :focus-visible になっていない').not.toBeNull();
    if (!bottomEdge) throw new Error('unreachable');

    expect(bottomEdge.isActive, 'Shift+Tab で到達したのが選択中のタブではない').toBe(true);
    expect(bottomEdge.selectionShadow, '選択線が下辺 2px の実線であること').toMatch(
      /0px -2px 0px 0px/,
    );

    // 下から見た配置: 選択線が 0〜2px、リングの下辺が |offset| - width 〜 |offset| px。
    // 両者が接していれば、連続した白帯の高さは 2 + outlineWidth。
    const ringBottomStart = -bottomEdge.outlineOffset - bottomEdge.outlineWidth;
    const whiteRunPx = ringBottomStart <= 2 ? 2 + bottomEdge.outlineWidth : 2;
    console.log(
      `[S78] 選択中 × フォーカス中の下辺: 白が連続 ${whiteRunPx}px` +
        `（選択線 2px + リング下辺 ${bottomEdge.outlineWidth}px、リング開始 ${ringBottomStart}px）`,
    );
    expect(
      whiteRunPx,
      '選択中かつフォーカス中の下辺の白が 4px でなくなった。outline-offset を変えたなら、' +
        'S41 の帯との隙間（>= 2px）と合わせて意図を確認すること（Issue #179 周2.5）',
    ).toBe(4);
  } finally {
    await closeApp(launched);
  }
});
