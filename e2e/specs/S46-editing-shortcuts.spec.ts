import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

test('S46 タブ名を編集中は Cmd+W が効かず、編集をやめると効く', async () => {
  const { window } = launched;

  // 直接の子孫（>）ではなく子孫セレクタにする。role="tablist" 化（Issue #20 PR 9）で
  // タブは .tab-bar__tabs > .tab-bar__tablist > .tab-bar__tab の3階層になったため。
  const tabs = window.locator('.tab-bar__tab');
  await expect(tabs).toHaveCount(1);

  // 2枚目のタブを開く。最後の1枚を Cmd+W で閉じると自動で新しいシェルタブが
  // 開く仕様（S08 参照）があり、それだと「本当に閉じ損ねていないか／閉じたか」が
  // タブ枚数だけでは判定しづらい。2枚以上（＝閉じても自動補充が起きない状況）で
  // 検証する。Cmd+T の直後は新しいタブが選択状態になる（S06 参照）ので、
  // 以降の Cmd+W は常にこの2枚目（末尾のタブ）を対象にする。
  await window.keyboard.press('Meta+t');
  await expect(tabs).toHaveCount(2);

  const target = tabs.last();
  const titleSpan = target.locator('.tab-bar__title');
  const input = window.locator('input.tab-bar__title-input');

  // タブ名をダブルクリックして編集状態にする（TabBar.tsx の実装どおり）。
  await titleSpan.dblclick();
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();

  // --- 編集中: Cmd+W を押してもタブは閉じない（Issue #63） -------------------
  // グローバルの keydown リスナーが e.target を見ずにショートカットを先取りしていた
  // ため、以前はここでタブが閉じていた。修正後は入力欄にフォーカスがある間は
  // 素通しし、タブ枚数も編集状態も変化しないはず。
  await window.keyboard.press('Meta+w');
  await expect(tabs).toHaveCount(2);
  // 素通しが「編集を打ち切る」side effect まで持っていないかも合わせて見る
  // （入力欄が閉じてしまっていないか・フォーカスが外れていないか）。
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();

  // --- 編集をやめる（Escape でキャンセル） -----------------------------------
  await window.keyboard.press('Escape');
  await expect(input).toHaveCount(0);

  // --- 編集をやめた後: Cmd+W でちゃんと閉じる ---------------------------------
  // 素通しの実装が効きすぎて全ショートカットを殺していないこと（xterm-helper-textarea
  // 以外の要素にフォーカスが無い通常時は、これまでどおりショートカットが機能する
  // こと）を、同じシナリオの中で確認する。
  await window.keyboard.press('Meta+w');
  await expect(tabs).toHaveCount(1);
});
