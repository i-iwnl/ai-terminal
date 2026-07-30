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

test('S08 タブを閉じられ、最後の1枚を閉じると新しいシェルが開く', async () => {
  const { window, workDir } = launched;

  // zsh のログインシェル起動直後は、macOS のターミナル連携スクリプトが
  // "Restored session: ..." 等の前置きメッセージを出し、改行なしで終わることがある。
  // そのとき zsh は行末マーク（既定では "%" の連続）を描画してから改行するため、
  // ゆるい /[$%#>]/ という正規表現だとこの前置きの "%%%%..." 行に早期マッチしてしまい、
  // まだ入力を受け付けられない状態でタイプしてしまう（実機で再現した）。
  // カレントディレクトリ名（workDir の末尾要素）を含む、本物のプロンプト行だけに
  // マッチする正規表現で待つことでこれを避ける。
  const cwdName = workDir.split('/').pop() as string;
  const promptPattern = new RegExp(`${escapeRegExp(cwdName)}\\s*[%#]`);

  // 直接の子孫（>）ではなく子孫セレクタにする。role="tablist" 化（Issue #20 PR 9）で
  // タブは .tab-bar__tabs > .tab-bar__tablist > .tab-bar__tab の3階層になったため。
  const tabs = window.locator('.tab-bar__tab');

  // 起動直後の1枚目のタブ。
  await expect(tabs).toHaveCount(1);
  const screens = window.locator('.terminal-pane__container .xterm-screen');
  await expect(screens.nth(0)).toContainText(promptPattern, { timeout: 20_000 });

  // このタブに目印を出力しておく。閉じたあとに自動で開く新しいシェルが
  // 「同じタブの使い回し」ではなく本当に新しい PTY であることを、
  // この目印が引き継がれていないことで確認するために使う。
  await window.locator('.xterm-helper-textarea').first().focus();
  await window.keyboard.type('echo BEFORE-CLOSE-MARKER');
  await window.keyboard.press('Enter');
  await expect(screens.nth(0)).toContainText('BEFORE-CLOSE-MARKER', { timeout: 10_000 });

  // タブを増やしてから、タブバーの「x」ボタンで閉じられることを確認する。
  await window.keyboard.press('Meta+t');
  await expect(tabs).toHaveCount(2);

  await tabs.nth(1).locator('.tab-bar__close').click();
  await expect(tabs).toHaveCount(1);

  // 最後の1枚を Cmd+W で閉じる。タブが0枚になる代わりに、新しいシェルタブが
  // 自動で開くはず（useTabs.ts の closeTab: remaining.length === 0 の分岐）。
  await window.keyboard.press('Meta+w');

  // 一瞬 0 枚になったとしても、最終的には自動で開いた新しいタブで1枚に戻る。
  await expect(tabs).toHaveCount(1);

  // タブが0枚のときの空状態メッセージが出たままになっていないこと。
  await expect(window.locator('.terminal-stack__empty')).toHaveCount(0);

  // 自動で開いた新しいシェルが実際に機能していること（プロンプトが表示される）。
  //
  // 注意: タブバーの枚数が1に戻ったことと、`.terminal-pane__container` が
  // 「閉じる前と同じ画面」なのか「新しく開いた画面」なのかは別問題。
  // 閉じる前のタブに残していた目印（BEFORE-CLOSE-MARKER）がまだ残っている間は
  // 待ち続け、目印が消えて（＝本当に新しい PTY に置き換わって）から
  // プロンプトを確認することで、閉じる処理の完了前に古い画面へ入力してしまう
  // 競合状態を避ける。
  const newScreen = window.locator('.terminal-pane__container .xterm-screen').first();
  await expect(newScreen).not.toContainText('BEFORE-CLOSE-MARKER', { timeout: 20_000 });
  await expect(newScreen).toContainText(promptPattern, { timeout: 20_000 });

  await window.locator('.xterm-helper-textarea').first().focus();
  await window.keyboard.type('echo AUTO-OPENED-SHELL');
  await window.keyboard.press('Enter');
  await expect(newScreen).toContainText('AUTO-OPENED-SHELL', { timeout: 10_000 });
});
