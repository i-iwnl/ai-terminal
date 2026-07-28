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
  // spec ごとに Electron を起動し直すため、1回のフル実行で起動がシナリオ数だけ走る。
  // この回数を繰り返すと稀に起動自体が失敗する（テスト本体とは無関係の一過性クラッシュ）。
  // リトライで吸収するが、本物の失敗は2回とも落ちるので見逃さない。
  // 実行結果に flaky が並ぶようなら、それは隠すべきではない兆候として扱うこと。
  retries: 1,
  // 1テスト = Electron 1起動。実測でコールドスタートだけで 30 秒を超えることがあり
  // （マシンが混んでいるとき）、60 秒だと起動待ちで予算を使い切って beforeEach が
  // タイムアウトする。テスト本体の待ちと合わせて余裕を持たせる。
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { outputFolder: 'e2e/report', open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
