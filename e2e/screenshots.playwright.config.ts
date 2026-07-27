import { defineConfig } from '@playwright/test';

/**
 * README の使い方ガイド用スクリーンショットを撮る専用の設定。
 *
 * ルートの playwright.config.ts は testDir を ./e2e/specs に固定しているため、
 * ここに e2e/screenshots.spec.ts を置いても `npx playwright test`（= make e2e）
 * では拾われない。撮影は毎回アプリを起動し直すぶん遅く、通常の CI/開発ループに
 * 混ぜたくないため、意図的に別ファイルに分離している。
 *
 * 実行: npx playwright test --config=e2e/screenshots.playwright.config.ts
 *       （make e2e-screenshots からも呼ぶ）
 */
export default defineConfig({
  testDir: '.',
  testMatch: 'screenshots.spec.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    trace: 'off',
    screenshot: 'off',
  },
});
