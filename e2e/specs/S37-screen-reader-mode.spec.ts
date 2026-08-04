import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp | undefined;

test.afterEach(async () => {
  if (launched) await closeApp(launched);
  launched = undefined;
});

/**
 * ターミナルの内容は WebGL レンダラが canvas に描くため、DOM にテキストが
 * 1文字も存在しない。つまり **screenReaderMode が無効な状態では、VoiceOver から
 * このアプリの主コンテンツが完全に不在**になる（Issue #23）。
 *
 * screenReaderMode を有効にすると、xterm が読み上げ用の要素を別に生やす。
 * ここではその要素の有無を、既定（無効）と設定で有効にした場合の**両方**で見る。
 * 片方だけ見ても「常に出ている / 常に出ていない」と区別が付かない。
 *
 * なお実際に VoiceOver が読み上げるかは自動では確認できない（OS の支援技術を
 * 起動する必要がある）。ここで担保するのは「読み上げの対象になる DOM が
 * 存在するか」まで。
 */
test('S37 設定でターミナルをスクリーンリーダーから読めるようにできる', async () => {
  // --- 既定（無効）: 読み上げ用の要素が無いこと ---
  launched = await launchApp();
  const a11yWhenOff = launched.window.locator('.xterm-accessibility');
  await expect(launched.window.locator('.xterm-screen')).toBeVisible({ timeout: 15_000 });
  await expect(a11yWhenOff).toHaveCount(0);
  await closeApp(launched);

  // --- 設定で有効化: 読み上げ用の要素が生えること ---
  launched = await launchApp({ config: { screenReaderMode: true } });
  const { window } = launched;
  await expect(window.locator('.xterm-screen')).toBeVisible({ timeout: 15_000 });

  const a11y = window.locator('.xterm-accessibility');
  await expect(a11y).toHaveCount(1);

  // 出力した文字列が、canvas ではなく DOM のテキストとして読める状態になること。
  // ここが「支援技術から見えるか」の実質的な判定。
  await window.keyboard.type('echo SCREEN_READER_OK\n');
  await expect(a11y).toContainText('SCREEN_READER_OK', { timeout: 15_000 });

  // --- タブが複数あっても .xterm-accessibility はちょうど1個であること ---
  //
  // xterm は screenReaderMode 有効時に aria-live="assertive" の live region を
  // 生成する（AccessibilityManager）。assertive は読み上げを割り込んで中断するため、
  // 支援技術に露出している live region が2個以上になると、片方の読み上げが
  // もう片方に潰される（design-review.md の「案の前提そのものを壊した指摘」）。
  //
  // App.tsx は screenReaderMode をアクティブなタブにだけ渡す（issue-56 PR 0-a）。
  // .xterm-accessibility は各タブが自分の Terminal インスタンスの screenReaderMode
  // オプションに応じて生やす DOM 要素で、visibility: hidden は生成そのものを止めない
  // （生成後に描画とアクセシビリティツリーへの露出を消すだけ）。つまりこのガードを
  // 外すと、非アクティブなタブでも .xterm-accessibility が生えたままになり、
  // ここでの toHaveCount(1) は素の DOM 個数のまま 2 に落ちて赤くなる
  // （visibility: hidden は「支援技術への露出」は防ぐが、Playwright の DOM 走査は
  // 防がないため、toBeVisible() 抜きの単純な個数比較で十分検出できる）。
  // それでもここで固定しておくのは、Issue #56（分割表示）が入ると同一タブ内の
  // 複数ペインが同時に visible になり、visibility: hidden による偶然の遮断（描画側も
  // 消える）が効かなくなるため。次にここを触る人が「1個で十分では」と緩めないよう、
  // 「タブが複数あっても1個」を明示的な不変条件としてテストに残す。
  // 直接の子孫（>）ではなく子孫セレクタにする。role="tablist" 化（Issue #20 PR 9）で
  // タブは .tab-bar__tabs > .tab-bar__tablist > .tab-bar__tab の3階層になったため。
  const tabs = window.locator('.tab-bar__tab');
  await expect(tabs).toHaveCount(1);

  await window.keyboard.press('Meta+t');
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(1)).toHaveClass(/is-active/);
  await expect(a11y).toHaveCount(1);

  // タブを行き来しても1個のまま付け替わること（useTerminal.ts の
  // screenReaderMode 変化の反映が効いていることの担保）。
  await window.keyboard.press('Meta+1');
  await expect(tabs.nth(0)).toHaveClass(/is-active/);
  await expect(a11y).toHaveCount(1);

  await window.keyboard.press('Meta+2');
  await expect(tabs.nth(1)).toHaveClass(/is-active/);
  await expect(a11y).toHaveCount(1);

  // --- 分割後も .xterm-accessibility はちょうど1個のまま（Issue #56 PR 4） ---
  //
  // 上のタブ切り替えとは別の経路。分割は「同一タブ内」の複数ペインを同時に
  // visible にするので、タブの visibility: hidden による遮断がそもそも効かない
  // 状況を作る。PaneTreeView（App.tsx から呼ぶ）がアクティブな1ペインにしか
  // screenReaderMode を渡していなければ、ここでも1個のまま保たれるはず
  // （このコメントの上、63〜64行目のコメントが予告していたとおりの実測）。
  //
  // **`toHaveCount` の数は「タブ2枚 + 分割で増えた1枚」で 3。** ここは長らく 2 と
  // 書かれており、**分割が反映される前の状態（タブ2枚 = ペイン2枚）で条件が
  // 成立してしまうため、実質「分割していない状態」を測っていた**。
  // `Meta+d` -> `spawnLeaf` は非同期（`await window.api.pty.spawn`）なので、
  // 速いマシンでは新しいペインがマウントされる前に 2 で成立して素通りし、
  // 遅いと 3 になって落ちる — という**両方向に flaky** な状態だった
  // （Issue #160 の周4 で 3回中2回落ちることを実測）。
  // loop.md の「検査は正しいが、その条件を踏んでいない」の実例。
  // **分割が実際に起きたことを数で固定する。**
  await window.keyboard.press('Meta+d');
  const panes = window.locator('.terminal-pane');
  await expect(panes).toHaveCount(3, { timeout: 15_000 });
  await expect(a11y).toHaveCount(1);
});
