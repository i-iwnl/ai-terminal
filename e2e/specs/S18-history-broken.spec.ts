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
 * 33333333-...jsonl はパース不能な JSONL。
 * Claude Code のセッション JSONL は公式に「内部フォーマットでバージョン間で変わりうる」
 * と明記されているため、このアプリはパース失敗のエントリを一覧から隠さず、
 * sessionId と更新時刻だけで縮退表示する（CLAUDE.md の鉄則5）。
 */
test('S18 壊れた履歴も縮退表示され、一覧から消えない', async () => {
  const { window } = launched;

  await window.locator('.sidebar__tabs button', { hasText: '履歴' }).click();

  // 一覧から消えず、3件とも表示されること
  await expect(window.locator('.history-item')).toHaveCount(3);

  const broken = window.locator('.history-item', { hasText: '33333333' });
  await expect(broken).toHaveCount(1);

  // sessionId の一部（先頭8文字）で表示されていること
  await expect(broken.locator('.history-item__title')).toContainText('33333333');

  // 更新時刻が表示されていること（相対時刻表記。空ではないこと）
  await expect(broken.locator('.history-item__meta')).not.toBeEmpty();

  // パースできなかったことが分かるエラー表示があること
  await expect(broken.locator('.history-item__error')).toBeVisible();
  await expect(broken.locator('.history-item__error')).toContainText('解析エラー');
});
