import { defineConfig } from '@playwright/test';

/**
 * E2E の設定。
 *
 * ビルド済みの Electron アプリ（out/）を起動するため、事前に `make build` が必要。
 * Electron 自体を起動するのでブラウザのダウンロードは不要。
 *
 * CI では実行しない（Linux ランナーでは xvfb が必要、macOS ランナーは高価）。
 * 実行は `make e2e`。
 */
export default defineConfig({
  testDir: './e2e/specs',
  // Electron のインスタンスを同時に複数立てると PTY とウィンドウ制御が不安定になる
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { outputFolder: 'e2e/report', open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
