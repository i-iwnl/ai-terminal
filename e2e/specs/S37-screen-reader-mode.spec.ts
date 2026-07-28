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
});
