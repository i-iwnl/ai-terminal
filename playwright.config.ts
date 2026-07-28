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
  // 実測では99起動中2回、Electron のプロセスは立つのにウィンドウが出ないまま
  // 60 秒待っても返らなかった。特定のシナリオに寄らず、毎回別の spec で起きる。
  // リトライで吸収するが、本物の失敗は2回とも落ちるので見逃さない。
  // 実行結果に flaky が並ぶようなら、それは隠すべきではない兆候として扱うこと。
  retries: 1,
  // 1テスト = Electron 1起動。
  //
  // 以前は 120 秒だった。ウィンドウを表示していた頃の「コールドスタートだけで
  // 30 秒を超えることがある」という実測に基づく値だったが、非表示化で起動が
  // 速くなり、桁が合わなくなっていた（本物のハングが最大2分間隠れる）。
  //
  // 現在の実測（macOS / 33シナリオのフル実行 33.7 秒）: 大半のテストが 0.7〜1.1 秒、
  // 最も遅い S23（GPU を有効にして WebGL の描画ピクセルを数える）で 7.2 秒。
  // その最遅ケースに対して約4倍の余裕を取って 30 秒とする。
  //
  // 起動に失敗したときの内訳（harness.ts）も、この 30 秒に収まっていること:
  // firstWindow の 15 秒 + 後始末の猶予 5 秒 = 20 秒。ここを超えると、
  // 後始末の途中でテストが打ち切られ、リトライで緑になっても Playwright が
  // 「どのテストにも属さないエラー」を出して make e2e が失敗する（実際に起きた）。
  timeout: 30_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { outputFolder: 'e2e/report', open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
