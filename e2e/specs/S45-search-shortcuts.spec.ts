import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

test('S45 Cmd+Shift+G で gemini が増えず、Cmd+G で検索が次のヒットへ進む', async () => {
  const { window } = launched;

  const screen = window.locator('.terminal-pane__container .xterm-screen').first();
  await expect(screen).toContainText(/[$%#>]/, { timeout: 20_000 });

  // --- 前半: Cmd+Shift+G は gemini を起動しない（Issue #62） -----------------
  //
  // 以前は Cmd+Shift+G が gemini の新規起動だった。macOS 全域で「前を検索」の
  // 標準キーのため、検索中に反射で押すと本物の gemini が1本余計に起動していた。
  // いまは「前を検索」に割り当てており、検索バーが閉じている状態で押されたときは
  // バーを開くだけにする（前回の検索語をいきなり検索してしまうと、検索欄が
  // 非表示のままヒットだけ動くことになるため。useTerminal.ts の
  // findInDirection のコメントと同じ決定）。
  const tabs = window.locator('.tab-bar__tab');
  await expect(tabs).toHaveCount(1);

  await window.locator('.xterm-helper-textarea').first().focus();
  await window.keyboard.press('Meta+Shift+G');

  await expect(tabs).toHaveCount(1);
  await expect(window.locator('.tab-bar__title').filter({ hasText: 'gemini' })).toHaveCount(0);
  await expect(window.locator('.terminal-search')).toBeVisible();

  // 次のセクションのために検索バーを一旦閉じ、状態をリセットする。
  await window.locator('.terminal-search button[title="検索を閉じる"]').click();
  await expect(window.locator('.terminal-search')).toBeHidden();

  // --- 後半: Cmd+G は検索欄にフォーカスが無くても次のヒットへ進む -------------
  //
  // ビューポートに収まらない間隔（150行のフィラー）を挟んで2箇所だけに現れる
  // 文字列を検索語にする。フォーカスをターミナル側へ戻してから Cmd+G を押し、
  // 画面に見えているマークが変わる（＝別のヒットへ移動した）ことを確認する。
  // xterm.js の SearchAddon が最初にどちらを拾うかには依存させない。
  await window.locator('.xterm-helper-textarea').first().focus();
  await window.keyboard.type('echo MARK-ONE; for i in {1..150}; do echo filler-$i; done; echo MARK-TWO');
  await window.keyboard.press('Enter');
  await expect(screen).toContainText('MARK-TWO', { timeout: 15_000 });

  await window.keyboard.press('Meta+f');
  await expect(window.locator('.terminal-search')).toBeVisible();
  await window.locator('.terminal-search input').fill('MARK-');

  // 検索欄からフォーカスを外し、ターミナル側へ戻す。
  // ここが本シナリオの要点: 以前は入力欄の Enter / Shift+Enter でしか
  // 次/前へ進められず、ターミナルをクリックした瞬間に検索を進める手段が無かった。
  await window.locator('.terminal-pane__container').first().click();

  const currentMark = async (): Promise<'ONE' | 'TWO' | null> => {
    const text = await screen.innerText();
    if (text.includes('MARK-ONE')) return 'ONE';
    if (text.includes('MARK-TWO')) return 'TWO';
    return null;
  };

  await window.keyboard.press('Meta+g');
  await expect.poll(currentMark, { timeout: 10_000 }).not.toBeNull();
  const first = await currentMark();

  await window.keyboard.press('Meta+g');
  await expect
    .poll(
      async () => {
        const mark = await currentMark();
        return mark !== null && mark !== first;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
});
