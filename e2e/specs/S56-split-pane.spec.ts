import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

/** 正規表現の特殊文字をエスケープする（workDir のディレクトリ名をそのままパターン化するため） */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Issue #56 PR 4: 分割を有効化する周の関門。design-review.md「3. 改訂した導入計画」
 * PR 4 行が定める2点を実測で固定する。
 *
 * 1. **2つの `.xterm-screen` が同時に可視であること。** 分割の意味そのもの
 *    （`.terminal-pane--hidden` はタブ切り替えの可視性で、同一タブ内の
 *    2ペインはどちらも `--hidden` が付かない。styles.css / TerminalPane.tsx 参照）。
 * 2. **`.terminal-pane.is-active` で一意に引けること。** 分割後も
 *    「今どのペインに打てるか」が DOM から一意に決まる。
 *
 * あわせて、この PR で踏むと分かっていた既知の問題・設計判断も同じテストの中で
 * 実測する（別スペックに割るほどの分量ではなく、同じセットアップを使い回せるため）。
 *
 * - 分割で作った2ペインが**独立した PTY**であること（片方に打った文字がもう片方に
 *   混ざらない）。同一タブに複数の ptyId が同時に存在するのは分割で初めて起きる状態。
 * - **Issue #67**（`.terminal-search` が細いペインからはみ出す）。分割で常態化すると
 *   分かっていた問題で、この周で修正した（styles.css の max-width / min-width）。
 * - **分割の拒否が実際に働くこと。** `canSplitPane`（実セル寸法ベース）が画面の
 *   端に達したら拒否し、理由が通知バナーに出ること。閾値のピクセル値は環境
 *   （フォントのレンダリング）に依存するため、ここでは決め打ちしない
 *   （design-review.md「紙の上の表は3回続けて誤っている」の教訓）。実際に
 *   繰り返し分割し、拒否が起きるまでの回数は問わず、**必ず拒否が起きること**
 *   と**その前に少なくとも1回は成功していること**の両方を実測する。
 * - **Cmd+W の意味変更。** ペインが複数あれば「ペインを閉じる」（タブは残る）、
 *   最後の1枚では「タブを閉じる」に落ちる（タブ数は変わらず新しいシェルが開く。
 *   S08 と同じ挙動）。
 */
test('S56 Cmd+D で分割でき、2つの xterm-screen が同時に見え、拒否と Cmd+W が働く', async () => {
  const { window, workDir } = launched;

  const cwdName = workDir.split('/').pop() as string;
  const promptPattern = new RegExp(`${escapeRegExp(cwdName)}\\s*[%#]`);

  const tabs = window.locator('.tab-bar__tab');
  const panes = window.locator('.terminal-pane');
  const visibleScreens = window.locator('.terminal-pane:not(.terminal-pane--hidden) .xterm-screen');
  const activePane = window.locator('.terminal-pane.is-active');
  const activeScreen = window.locator('.terminal-pane.is-active .xterm-screen');
  const activeHelper = window.locator('.terminal-pane.is-active .xterm-helper-textarea');
  const inactiveScreen = window.locator('.terminal-pane:not(.is-active) .xterm-screen');
  const errorNotice = window.locator('.notice-banner--error');

  // --- 起動直後: 1タブ1ペイン ---------------------------------------------
  await expect(tabs).toHaveCount(1);
  await expect(panes).toHaveCount(1);
  await expect(activeScreen).toContainText(promptPattern, { timeout: 20_000 });

  // --- Cmd+D: 右に分割。デフォルトのウィンドウ幅なら必ず成功するはず ----------
  await window.keyboard.press('Meta+d');
  await expect(panes).toHaveCount(2);
  // 分割はタブを増やさない（新しいペインが増えるだけ）。
  await expect(tabs).toHaveCount(1);

  // 関門1: 2つの .xterm-screen が同時に可視。
  await expect(visibleScreens).toHaveCount(2);
  // 関門2: .terminal-pane.is-active で一意に引ける。
  await expect(activePane).toHaveCount(1);

  // 新しいペイン（is-active側）はまだシェルが起動しきっていないことがあるので待つ。
  await expect(activeScreen).toContainText(promptPattern, { timeout: 20_000 });

  // --- 独立した PTY であること: 片方に打った文字がもう片方に混ざらない -------
  await activeHelper.focus();
  await window.keyboard.type('echo SPLIT-PANE-MARKER');
  await window.keyboard.press('Enter');
  await expect(activeScreen).toContainText('SPLIT-PANE-MARKER', { timeout: 10_000 });
  await expect(inactiveScreen).not.toContainText('SPLIT-PANE-MARKER');

  // --- Issue #67: 細いペインで検索バーがはみ出さないこと ---------------------
  // 分割直後の is-active ペインは全幅の半分程度に狭まっている。
  await window.keyboard.press('Meta+f');
  const search = window.locator('.terminal-search');
  await expect(search).toBeVisible();
  await expect
    .poll(async () => {
      const searchBox = await search.boundingBox();
      const paneBox = await activePane.boundingBox();
      if (!searchBox || !paneBox) return null;
      // 1px の丸め誤差を許容する。
      return searchBox.x + searchBox.width <= paneBox.x + paneBox.width + 1;
    })
    .toBe(true);
  // 検索バーを閉じて後続の操作に影響しないようにする。
  await window.keyboard.press('Meta+f');
  await expect(search).toBeHidden();

  // --- 分割の拒否: 画面の端に達するまで繰り返し分割し、必ず拒否が起きることを見る ---
  // 閾値のピクセル値はフォントのレンダリング環境に依存するため決め打ちしない
  // （design-review.md の教訓）。毎回 Cmd+D を押し、ペイン数が増えたか
  // （成功）、エラー通知が出たか（拒否）のどちらかになるまで待つ。
  let succeededAgain = false;
  let rejected = false;
  for (let attempt = 0; attempt < 8 && !rejected; attempt += 1) {
    const before = await panes.count();
    await window.keyboard.press('Meta+d');

    await expect
      .poll(
        async () => {
          const afterCount = await panes.count();
          const noticeVisible = await errorNotice.isVisible().catch(() => false);
          return afterCount > before || noticeVisible;
        },
        { timeout: 5_000 },
      )
      .toBe(true);

    const afterCount = await panes.count();
    if (afterCount > before) {
      succeededAgain = true;
    } else {
      rejected = true;
    }
  }

  expect(succeededAgain, '画面の端に達する前に、少なくとも1回は分割が成功しているはず').toBe(true);
  expect(rejected, '画面の端まで分割を繰り返したら、必ずどこかで拒否されるはず').toBe(true);
  await expect(errorNotice).toContainText('分割できません');

  // --- Cmd+W: ペインを1枚ずつ閉じ、最後の1枚で「タブを閉じる」に落ちる ---------
  const paneCountBeforeClosing = await panes.count();
  expect(paneCountBeforeClosing).toBeGreaterThan(1);

  for (let remaining = paneCountBeforeClosing; remaining > 1; remaining -= 1) {
    await window.keyboard.press('Meta+w');
    await expect(panes).toHaveCount(remaining - 1);
    // ペインが複数残っている間は、タブそのものは閉じない。
    await expect(tabs).toHaveCount(1);
  }

  // 最後の1枚。design-review.md「確定している仕様」: ペインが1枚しか無ければ
  // Cmd+W はタブを閉じる。S08 と同じ「最後の1枚を閉じると新しいシェルが自動で開く」
  // 挙動により、タブ数は1のまま・ペインも1枚の新しいシェルに置き換わるはず。
  await window.keyboard.press('Meta+w');
  await expect(tabs).toHaveCount(1, { timeout: 10_000 });
  await expect(panes).toHaveCount(1);
});
