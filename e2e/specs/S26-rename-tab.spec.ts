import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

test('S26 タブタイトルをダブルクリックで編集できる', async () => {
  const { window } = launched;

  // 直接の子孫（>）ではなく子孫セレクタにする。role="tablist" 化（Issue #20 PR 9）で
  // タブは .tab-bar__tabs > .tab-bar__tablist > .tab-bar__tab の3階層になったため。
  const tabs = window.locator('.tab-bar__tab');
  await expect(tabs).toHaveCount(1);

  const titleSpan = tabs.first().locator('.tab-bar__title');
  const input = window.locator('input.tab-bar__title-input');

  // 編集前のタイトルを控えておく。固有の文字列（例: "zsh"）を直接期待値に
  // 書かず、「編集の前後で変わったか／変わらなかったか」という性質で検証する。
  const originalTitle = ((await titleSpan.textContent()) ?? '').trim();
  expect(originalTitle.length).toBeGreaterThan(0);

  // タイトルをダブルクリックすると、その場に編集用の input が現れる。
  await titleSpan.dblclick();
  await expect(input).toBeVisible();
  await expect(input).toHaveAttribute('aria-label', 'タブ名を編集');

  // 初期値は現在のタイトルで、フォーカスされ全選択されている。
  await expect(input).toHaveValue(originalTitle);
  await expect(input).toBeFocused();
  const selection = await input.evaluate((el) => {
    const inputEl = el as HTMLInputElement;
    return { start: inputEl.selectionStart, end: inputEl.selectionEnd, length: inputEl.value.length };
  });
  expect(selection.start).toBe(0);
  expect(selection.end).toBe(selection.length);

  // 新しいタイトルを入力して Enter で確定すると、タブタイトルが更新されて
  // span 表示に戻る。ここは自分で設定した文字列なので固有名との一致でよい。
  const renamedTitle = 'E2E-RENAMED-TITLE';
  await input.fill(renamedTitle);
  await input.press('Enter');
  await expect(input).toHaveCount(0);
  await expect(titleSpan).toHaveText(renamedTitle);

  // Escape でキャンセルすると、入力中の下書きは捨てられ元のタイトルのまま
  // span 表示に戻る（＝直前に確定した renamedTitle から変化しない）。
  await titleSpan.dblclick();
  await expect(input).toBeVisible();
  await input.fill('DISCARDED-BY-ESCAPE');
  await input.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(titleSpan).toHaveText(renamedTitle);

  // 空白のみを入力して確定しても、trim 後は空文字になるため元のタイトルが維持される。
  await titleSpan.dblclick();
  await expect(input).toBeVisible();
  await input.fill('   ');
  await input.press('Enter');
  await expect(input).toHaveCount(0);
  await expect(titleSpan).toHaveText(renamedTitle);
});
