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
 * Issue #20 J（PR 14「キーボード」）。
 *
 * `Cmd+Shift+]` / `Cmd+Shift+[`（次/前のタブ）と `Cmd+E`（直前のタブへ戻る）は
 * どちらもタブの並び順・アクティブ履歴だけで完結する操作で、タスク一覧の
 * フィクスチャに依存せず実タブだけで検証できる。
 *
 * `Cmd+]` / `Cmd+[`（Shift 無し）は Issue #56 でペイン移動に割り当て済み
 * （S61-pane-navigation.spec.ts）。ここでは Shift 付きがペイン移動と衝突せず
 * タブ移動になることも併せて確認する。
 */
test('S67 Cmd+Shift+] / Cmd+Shift+[ で次/前のタブへ、Cmd+E で直前のタブへ戻る', async () => {
  const { window } = launched;
  const tabs = window.locator('.tab-bar__tab');

  // **最初のシェルタブが出るまで待つ。** グローバルショートカットの keydown
  // リスナは App.tsx の useEffect で張られるので、マウント前に押したキーは
  // 取りこぼされる（Issue #20 PR 11 の S55 でまったく同じ原因で落ちた前例）。
  await expect(tabs).toHaveCount(1, { timeout: 15_000 });

  await window.keyboard.press('Meta+t');
  await expect(tabs).toHaveCount(2);
  await window.keyboard.press('Meta+t');
  await expect(tabs).toHaveCount(3);
  await expect(tabs.nth(2)).toHaveClass(/is-active/);

  // 次のタブ（Cmd+Shift+]）: 末尾から先頭へ折り返す。
  // Shift 付きの記号キーは US 配列で `.key` が変わる（`]` -> `}`）ため、
  // レイアウトに依存しない物理キー名で送る（shortcuts.ts が `.code` で
  // 判定しているのと同じ理由）。
  await window.keyboard.press('Meta+Shift+BracketRight');
  await expect(tabs.nth(0)).toHaveClass(/is-active/);

  // 前のタブ（Cmd+Shift+[）: 先頭から末尾へ折り返す。
  await window.keyboard.press('Meta+Shift+BracketLeft');
  await expect(tabs.nth(2)).toHaveClass(/is-active/);

  // 直前のタブへ戻る（Cmd+E）: 1枚目 -> Cmd+E で3枚目（直前）へ、
  // もう一度 Cmd+E で1枚目へ（直近2枚をトグルする）。
  await window.keyboard.press('Meta+1');
  await expect(tabs.nth(0)).toHaveClass(/is-active/);
  await window.keyboard.press('Meta+e');
  await expect(tabs.nth(2)).toHaveClass(/is-active/);
  await window.keyboard.press('Meta+e');
  await expect(tabs.nth(0)).toHaveClass(/is-active/);
});
