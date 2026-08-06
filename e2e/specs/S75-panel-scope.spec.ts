import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/harness';

/**
 * Issue #20 の I-2 / Issue #119 の周3。
 *
 * サイドバーの3パネルは**スコープが全く違うのに同じ見た目で並んでいた。**
 *
 * | パネル | 何の集合か | 範囲 |
 * |---|---|---|
 * | タスク | 動いている claude プロセス | **既定はマシン全体**（他アプリ起動分も含む） |
 * | 履歴 | 終わったセッションのファイル | アクティブなペインの cwd（`cd` に追従する） |
 * | メモ | このアプリが保存した走り書き | アプリのデータディレクトリ |
 *
 * 初見のユーザーは「3つとも、このアプリで開いたもののリスト」だと推測する。
 * とくに**タスクに他プロジェクトのセッションが混ざる**のは、説明が無いと
 * 「なぜ知らない名前が出るのか」で止まる。Dock バッジ（`updateDockBadge` は
 * `scopeAgentsToCwd` に関わらずマシン全体を数える）が「3」なのに一覧が1件、
 * という食い違いの説明にもなる。
 *
 * 履歴だけは #117 で範囲の見出しが入っていた（S71 が固定している）。
 * ここでは**タスクとメモ**の分と、**3パネルで位置と体裁が揃っていること**、
 * および**見出しの階層**（h1 -> h2 -> h3）を固定する。
 *
 * ## なぜ階層まで見るか
 *
 * 本体ウィンドウには `<h2>` がフラットに並ぶだけで **`<h1>` が1つも無かった**。
 * VoiceOver のローターで見出しを辿っても階層が読めない。周3 で
 * 視覚的非表示の `<h1>` を足し、パネル内の区切り（`あなたの番 2件` /
 * `全体メモ`）と空状態の見出しを `<h3>` に落とした。
 *
 * ## 「範囲」と「区切り」の見た目が違うこと
 *
 * `.panel-scope`（範囲・1パネルに1つ）と `.task-group__heading`（区切り・n 個）は
 * 周3 より前は**宣言レベルで完全に一致していた**。同じ見た目のまま範囲の行を足すと、
 * タスクパネルでは「同じ体裁の見出しが3つ縦に並び、1つ目だけ意味が違う」状態になる。
 * CSS の宣言そのものは `test/unit/css-tokens.test.ts` が突き合わせているので、
 * ここでは**実際に描画された結果**が違うことを見る。
 */
test('S75 3パネルの最上部に「いまどの範囲か」が常設され、区切りの見出しとは体裁が違う', async () => {
  const launched = await launchApp();
  try {
    const { window } = launched;

    const screen = window.locator('.terminal-pane__container .xterm-screen').first();
    await expect(screen).toContainText(/[$%#>]/, { timeout: 20_000 });

    // --- 見出し階層の頂点 -------------------------------------------------------
    const h1 = window.locator('h1');
    await expect(h1).toHaveCount(1);
    await expect(h1).toHaveText('ai-terminal');
    // 視覚的には出さない（タイトルバーは hiddenInset で見えないので、
    // 画面に文字を増やす理由が無い）。ただし支援技術からは読める必要があるので、
    // `display: none` / `visibility: hidden` で消してはいけない。
    const h1Hidden = await h1.evaluate((el) => {
      const s = getComputedStyle(el);
      return { display: s.display, visibility: s.visibility, w: el.getBoundingClientRect().width };
    });
    expect(h1Hidden.display).not.toBe('none');
    expect(h1Hidden.visibility).not.toBe('hidden');
    expect(h1Hidden.w).toBeLessThanOrEqual(1);

    // --- タスク（既定タブ） -----------------------------------------------------
    const taskScope = window.locator('.task-list .panel-scope');
    // ハーネスの既定は scopeAgentsToCwd: false（= マシン全体）。
    // **この事実は周3 より前は画面のどこにも出ていなかった。**
    //
    // ⛔ **プロバイダ名を焼き込まない**（#180 周13）。このパネルには
    // 「タブに戻せる AI」の節があり、そこには gemini も入る（tmux から取るので
    // `claude agents --json` に依らない）。「…の Claude」と名乗ると嘘になる。
    await expect(taskScope).toHaveText('このマシン全体の AI');
    await expect(taskScope).not.toContainText('Claude');
    await expect(taskScope).toHaveJSProperty('tagName', 'H2');

    // 区切りの見出しは h3 に落ちている（範囲の h2 の下）。
    const groupHeadings = window.locator('.task-group__heading');
    await expect(groupHeadings.first()).toHaveJSProperty('tagName', 'H3');

    // 「範囲」と「区切り」が実際に違って見えること。日本語では
    // `text-transform: uppercase` が効かないので、主な手がかりは下線のほう。
    const looks = await window.evaluate(() => {
      const scope = document.querySelector('.task-list .panel-scope');
      const group = document.querySelector('.task-group__heading');
      if (!scope || !group) return null;
      const read = (el: Element) => {
        const s = getComputedStyle(el);
        return { border: s.borderBottomWidth, transform: s.textTransform, spacing: s.letterSpacing };
      };
      return { scope: read(scope), group: read(group) };
    });
    expect(looks).not.toBeNull();
    expect(looks?.scope.border, '範囲の行は下線で本文と切る').toBe('1px');
    expect(looks?.group.border, '区切りの見出しに線は引かない').toBe('0px');
    expect(looks?.group.transform).toBe('uppercase');
    expect(looks?.scope.transform).toBe('none');

    // --- メモ -------------------------------------------------------------------
    await window.locator('.sidebar__tabs button', { hasText: 'メモ' }).click();
    const memoScope = window.locator('.memo-panel .panel-scope');
    await expect(memoScope).toHaveText('このアプリのメモ');
    await expect(memoScope).toHaveJSProperty('tagName', 'H2');
    // 節の見出し（全体メモ / セッションのメモ）は h3 に落ちている。
    const memoHeadings = window.locator('.memo-panel__heading');
    await expect(memoHeadings).toHaveCount(2);
    await expect(memoHeadings.first()).toHaveJSProperty('tagName', 'H3');
    // 全体メモが**フォルダをまたぐ**ことを placeholder が言っていること
    // （README は「常に1枚だけ」と書いているが、画面上には手がかりが無かった）。
    await expect(window.locator('.memo-panel__textarea').first()).toHaveAttribute(
      'placeholder',
      /どのフォルダ/,
    );

    // --- 履歴（S71 が文言を固定しているので、ここでは体裁だけ） -------------------
    await window.locator('.sidebar__tabs button', { hasText: '履歴' }).click();
    const historyScope = window.locator('.history-list .panel-scope');
    await expect(historyScope).toHaveJSProperty('tagName', 'H2');

    // --- 3パネルとも「1パネルに1つ」であること ----------------------------------
    // 増やすと「範囲」という語の意味が薄れる。
    await expect(window.locator('.sidebar__content .panel-scope')).toHaveCount(1);
  } finally {
    await closeApp(launched);
  }
});
