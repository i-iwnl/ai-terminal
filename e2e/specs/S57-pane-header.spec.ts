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
 * Issue #56 PR 5: アクティブ表現（提案 C'）+ ペインヘッダ（提案 G）+ aria 名。
 *
 * design-review.md 提案 G が明記している関門は次の3点:
 *
 * 1. **1ペインのときはヘッダを出さない。分割中だけ出す。**
 * 2. **`zsh` / `claude` / `claude (再開)` + cwd の basename** を表示する。
 * 3. **ヘッダが xterm の内容を隠さないこと。**
 *
 * 3 は当初 `position: absolute` の重ね描きで実装したが、レビューで
 * 「不透明なヘッダが最初の行の上に乗り、分割中は各ペインの最初の行が
 * 実質読めない」（実測: 15px の行のうち14px が隠れていた）と指摘され、
 * 通常の flex フローに入れる実装へ直した。フローに入れると
 * `.terminal-pane__container` の内寸は分割中に1行分減るが（design-review が
 * 懸念した「幾何の分岐」）、`ipcMain.on('pty:resize', ...)` で発火回数を
 * 実測すると、左右分割（Cmd+D）1回あたりの `pty:resize` は重ね描き版でも
 * フロー版でも2回で変わらなかった（分割自体が常に幅か高さを変えるため、
 * ヘッダの出現は「既に飛ぶ1回」が運ぶ値を変えるだけで、追加の発火にはならない）。
 * そのため、内容を隠さないことを優先してフロー実装を採用している。
 *
 * ここでは「行数が変わらないこと」ではなく、**ヘッダの下端が最初の行の上端より
 * 上にあること**（＝重なっていないこと）を実測して固定する。行数だけを見る
 * 検査では、行数が変わらないまま内容が隠れるケース（重ね描き）を検出できない。
 *
 * あわせて、木のルートでない leaf に role="group" + aria-label が付き、
 * role="tabpanel" は木のルート（.pane-split）1個のままであること（PR 4 の
 * 1タブ=1tabpanel契約と矛盾しないこと。PR 5「aria 名」）も見る。
 */
test('S57 分割中だけペインヘッダが出て、最初の行を隠さずに種別と cwd を示す', async () => {
  const { window, workDir } = launched;
  const cwdName = workDir.split('/').pop() as string;

  const panes = window.locator('.terminal-pane');
  const headers = window.locator('.pane-header');
  const activePane = window.locator('.terminal-pane.is-active');
  const inactivePane = window.locator('.terminal-pane:not(.is-active)');
  const rowsOf = (scope: string): ReturnType<typeof window.locator> =>
    window.locator(`${scope} .xterm-rows > div`);

  /** そのペインのヘッダが、同じペインの最初の行と重なっていないこと。 */
  async function expectHeaderDoesNotCoverFirstRow(paneLocator: typeof activePane): Promise<void> {
    const headerBox = await paneLocator.locator('.pane-header').boundingBox();
    const firstRowBox = await paneLocator.locator('.xterm-rows > div').first().boundingBox();
    expect(headerBox, 'ヘッダの bounding box が取得できない').not.toBeNull();
    expect(firstRowBox, '最初の行の bounding box が取得できない').not.toBeNull();
    // 1px の丸め誤差を許容する。ヘッダの下端が最初の行の上端以下（＝重ならない）であること。
    expect(
      headerBox!.y + headerBox!.height,
      `ヘッダ（下端 ${headerBox!.y + headerBox!.height}）が最初の行（上端 ${firstRowBox!.y}）と重なっている`,
    ).toBeLessThanOrEqual(firstRowBox!.y + 1);
  }

  /** アクティブなペインのコンテナに実際に描かれている box-shadow（アクセント線）。 */
  const activeAccentBoxShadow = (): Promise<string> =>
    window
      .locator('.terminal-pane.is-active .terminal-pane__container')
      .first()
      .evaluate((el) => getComputedStyle(el).boxShadow);

  // --- 起動直後: 1タブ1ペイン。ヘッダは出ない -------------------------------
  await expect(panes).toHaveCount(1);
  await expect(headers).toHaveCount(0);
  await expect(window.locator('.terminal-pane.is-active .xterm-screen')).toContainText(
    new RegExp(`${cwdName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[%#]`),
    { timeout: 20_000 },
  );

  // アクティブ表現の3層のうち2層目（アクセント線）も、3層目（ペインヘッダ）と
  // 同じく「分割中だけ」出す（design-review.md 提案 G「1ペインのときは出さない」）。
  // 1ペインのタブでは、この線は「どのペインがアクティブか」を伝える相手が無く、
  // 常時出ていて何も伝えないクロームになる（PR 5 の実装漏れ。ペインヘッダの
  // 条件と食い違っていた不具合の是正をここで固定する）。
  expect(await activeAccentBoxShadow(), '1ペインのときにアクセント線が出てしまっている').toBe(
    'none',
  );

  const rowCountBeforeSplit = await rowsOf('.terminal-pane.is-active').count();
  expect(rowCountBeforeSplit).toBeGreaterThan(0);

  // --- Cmd+D: 右に分割 ------------------------------------------------------
  await window.keyboard.press('Meta+d');
  await expect(panes).toHaveCount(2);
  await expect(headers).toHaveCount(2);
  // 分割直後は ResizeObserver -> fit() -> 再描画が非同期なので、行の実描画が
  // 収まるまで待ってから座標を測る。
  await expect(rowsOf('.terminal-pane.is-active')).not.toHaveCount(0, { timeout: 10_000 });
  await expect(rowsOf('.terminal-pane:not(.is-active)')).not.toHaveCount(0, { timeout: 10_000 });

  // 分割中は逆に出ること（ヘッダと対で固定する）。
  expect(await activeAccentBoxShadow(), '分割中なのにアクセント線が出ていない').not.toBe('none');

  // --- 関門3: ヘッダが最初の行を隠していないこと（両方のペインで） -----------
  await expectHeaderDoesNotCoverFirstRow(activePane);
  await expectHeaderDoesNotCoverFirstRow(inactivePane);

  // --- 関門2: ヘッダの文字列（種別 + cwd の basename） -----------------------
  // 新しいペイン（is-active 側）は splitActivePane が作る新しいシェル。
  // cwd は分割元から引き継ぐため、basename は同じ demo-project になる。
  await expect(activePane.locator('.pane-header')).toContainText('zsh');
  await expect(activePane.locator('.pane-header')).toContainText(cwdName);
  // 分割元（起動時からのシェル）もヘッダを持ち、同じ basename を示す。
  await expect(inactivePane.locator('.pane-header')).toContainText('zsh');
  await expect(inactivePane.locator('.pane-header')).toContainText(cwdName);

  // --- aria 名: 木のルートでない leaf は role="tabpanel" を名乗らない ---------
  // PR 4 の「role="tabpanel" は木のルートだけ」契約を壊していないこと。
  await expect(window.locator('[role="tabpanel"]')).toHaveCount(1);
  await expect(window.locator('.terminal-pane[role="group"]')).toHaveCount(2);
  const activeAriaLabel = await activePane.getAttribute('aria-label');
  expect(activeAriaLabel).toContain('zsh');
  expect(activeAriaLabel).toContain(cwdName);

  // --- 1ペインへ戻すと、ヘッダが消えて元の行数に戻ること ---------------------
  // ヘッダはフローに入っているので、消えれば占めていた分の高さが
  // .terminal-pane__container にそのまま返る（漏れなく戻ることの確認）。
  await window.keyboard.press('Meta+w');
  await expect(panes).toHaveCount(1);
  await expect(headers).toHaveCount(0);
  await expect(rowsOf('.terminal-pane.is-active')).toHaveCount(rowCountBeforeSplit, {
    timeout: 10_000,
  });
  // ヘッダと同じく、1ペインに戻ればアクセント線も消えること。
  expect(
    await activeAccentBoxShadow(),
    '1ペインに戻ったのにアクセント線が残っている',
  ).toBe('none');
});
