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
 *
 * Issue #20 I-3: 解析エラーは「打つ手が無い情報」なので、赤字2行（要対応の色）
 * ではなく灰色1行に落とし、resume 自体はできることを明示する。生のエラー文言は
 * ツールチップ（title 属性）に残す。
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

  // パースできなかったことが分かる、打つ手の無い情報向けの灰色1行表示があること。
  // resume 自体はできることも明示する。
  const errorLine = broken.locator('.history-item__error');
  await expect(errorLine).toBeVisible();
  await expect(errorLine).toContainText('内容を読めませんでした');
  await expect(errorLine).toContainText('再開はできます');
  // 詳細な生エラー文言はツールチップ（title 属性）にのみ残す。
  await expect(errorLine).toHaveAttribute('title', /解析エラーの詳細/);
});
