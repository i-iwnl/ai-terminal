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
 * ai-title の無いエントリ（22222222-...）は message.content から拾った
 * 最初のユーザープロンプトで表示される。
 * このエントリの content はリスト形式で thinking 要素が混ざっているため、
 * このテストは「text 要素だけを拾えている」ことの担保も兼ねる。
 */
test('S17 タイトルが無い履歴は最初のプロンプトで表示される', async () => {
  const { window } = launched;

  await window.locator('.sidebar__tabs button', { hasText: '履歴' }).click();
  await expect(window.locator('.history-item')).toHaveCount(3);

  const untitled = window.locator('.history-item', {
    hasText: 'タブの切り替えでフォーカスが外れる問題を調べて',
  });
  await expect(untitled).toHaveCount(1);
  await expect(untitled.locator('.history-item__title')).toHaveText(
    'タブの切り替えでフォーカスが外れる問題を調べて',
  );

  // thinking 要素の内容は表示に混ざっていないこと
  await expect(untitled).not.toContainText('無視されるべき要素');

  // gitBranch も表示されていること
  await expect(untitled.locator('.history-item__meta')).toContainText('feat/tabs');
});
