import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

/** macOS のウィンドウタイトル（Mission Control / ウィンドウメニュー / App Exposé に出る名前）。 */
async function windowTitle(app: LaunchedApp['app']): Promise<string> {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle() ?? '');
}

/**
 * Issue #131: タブの見出しは「いま選んでいるペイン」から借りない。
 *
 * **守っている本題**は、分割中に `Cmd+]` でペインを移っても、タブを識別する
 * 4つ（見出し / タブ上端のプロバイダ色 / ツールチップ / ウィンドウタイトル）が
 * 1つも変わらないこと。
 *
 * なぜ必要か: それまでタブは名前という属性を持たず、タブバーは `tabLeaf(tab)`
 * （＝いま選んでいるペイン）の `title` を借りていた。`Cmd+]` の想定頻度は
 * `shortcuts.ts` 自身の見積もりで **40〜80回/日**で、そのたびに4つとも
 * 書き換わっていた。とくにウィンドウタイトルは「どのウィンドウがどのプロジェクトか」を
 * 見分けるために入れたもの（`App.tsx` にその意図が明記されている）なので、
 * **分割している間だけその目的が消えていた**。
 *
 * **claude タブを分割して検証する。** 分割で作られるのは常にシェルなので、
 * 左が claude・右が shell になり、`Cmd+]` でプロバイダ色（`tab-bar__tab--claude`
 * / `--shell`）まで往復する。シェルタブを分割すると両方 shell になって
 * 色の往復が起きず、**この検査が意味を持つ条件を踏めない**。
 *
 * あわせて (d) 案の要点2つも見る。
 *
 * - タブに名前を付けても**ペインの名前は変わらない**（入り口と対象の一致）
 * - 名前を付けたタブは**先頭ペインを閉じても見出しが変わらない**（(b) 案の
 *   「ジャンプ」が起きないこと）
 */
test('S86 分割中にペインを移ってもタブの見出し・プロバイダ色・ウィンドウ名が変わらない', async () => {
  const { window } = launched;

  const activeTab = window.locator('.tab-bar__tab.is-active');
  const activeTabTitle = activeTab.locator('.tab-bar__title');
  const activeTabButton = activeTab.locator('.tab-bar__tab-button');
  const headers = window.locator('.pane-header');
  const titleInput = window.locator('.tab-bar__title-input');

  // --- claude タブを開く ----------------------------------------------------
  //
  // **起動直後のシェルが立つのを待ってから押す。** 待たずに押すと、設定の
  // 読み込みと初期シェルの spawn が終わる前に new-claude-tab が走り、
  // タブが1枚も増えないまま先へ進んでしまう（実測）。
  await expect(window.locator('.terminal-pane.is-active .xterm-screen')).toContainText(/[%#]/, {
    timeout: 20_000,
  });
  await window.keyboard.press('Meta+Shift+C');
  await expect(window.locator('.tab-bar__tab')).toHaveCount(2);
  const activeRows = window
    .locator('.terminal-pane:not(.terminal-pane--hidden) .xterm-rows')
    .first();
  await expect(activeRows).toContainText('FAKE CLAUDE READY', { timeout: 20_000 });
  await expect(activeTab).toHaveClass(/tab-bar__tab--claude/);

  // --- 分割する（右に新しいシェルが立つ）------------------------------------
  await window.keyboard.press('Meta+d');
  await expect(headers).toHaveCount(2);

  // 分割直後の「タブを識別する4つ」を控える。
  const titleAfterSplit = ((await activeTabTitle.textContent()) ?? '').trim();
  const classAfterSplit = (await activeTab.getAttribute('class')) ?? '';
  const tooltipAfterSplit = await activeTabButton.getAttribute('title');
  const osTitleAfterSplit = await windowTitle(launched.app);
  expect(titleAfterSplit.length).toBeGreaterThan(0);

  // **この検査が意味を持つ条件を assert する。** 左右のペインが別プロバイダで
  // なければ、色の往復は起きようがなく、検査が空振りする。
  await expect(headers.nth(0)).toContainText('claude');
  // **この `zsh` はハーネスの `$SHELL`（`/bin/zsh`）由来**で、リテラルではない
  // （Issue #137 でシェル名は動的になった）。リテラルへの退行を守るのは S88。
  await expect(headers.nth(1)).toContainText('zsh');

  // --- Cmd+] でペインを移る -------------------------------------------------
  await window.keyboard.press('Meta+BracketRight');
  // ペイン側は確かに移っている（＝キーが効いていないせいで green になっていない）。
  await expect(window.locator('.terminal-pane.is-active .pane-header')).toContainText('claude');

  expect(((await activeTabTitle.textContent()) ?? '').trim(), 'タブの見出しが動いた').toBe(
    titleAfterSplit,
  );
  expect((await activeTab.getAttribute('class')) ?? '', 'タブのプロバイダ色が動いた').toBe(
    classAfterSplit,
  );
  expect(await activeTabButton.getAttribute('title'), 'ツールチップが動いた').toBe(
    tooltipAfterSplit,
  );
  expect(await windowTitle(launched.app), 'ウィンドウタイトルが動いた').toBe(osTitleAfterSplit);

  // --- タブに名前を付ける（ダブルクリックの宛先は「タブ」）--------------------
  const paneNamesBefore = await headers.allTextContents();

  await activeTabTitle.dblclick();
  await expect(titleInput).toBeVisible();
  await expect(titleInput).toHaveAttribute('aria-label', 'タブ名を編集');
  const tabName = 'E2E-TAB-NAME';
  await titleInput.fill(tabName);
  await titleInput.press('Enter');
  await expect(titleInput).toHaveCount(0);
  await expect(activeTabTitle).toHaveText(tabName);
  expect(await windowTitle(launched.app)).toBe(tabName);

  // **ペインの名前は1つも変わっていない**（入り口と対象が一致していること）。
  expect(await headers.allTextContents(), 'タブ名の編集がペインの名前を書き換えた').toEqual(
    paneNamesBefore,
  );

  // --- 先頭ペイン（claude 側）を閉じても見出しが変わらない --------------------
  //
  // 借り先を「木の先頭 leaf」に固定するだけの案では、ここで見出しが
  // 繰り上がった別ペインの名前へジャンプする。
  await expect(window.locator('.terminal-pane.is-active .pane-header')).toContainText('claude');
  await window.keyboard.press('Meta+w');
  await expect(headers).toHaveCount(0);
  await expect(activeTabTitle).toHaveText(tabName);
  expect(await windowTitle(launched.app)).toBe(tabName);

  // --- 空文字で確定すると導出へ戻る -----------------------------------------
  await activeTabTitle.dblclick();
  await expect(titleInput).toBeVisible();
  await titleInput.fill('   ');
  await titleInput.press('Enter');
  await expect(titleInput).toHaveCount(0);
  await expect(activeTabTitle).not.toHaveText(tabName);
});
