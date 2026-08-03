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
  // Issue #120 D-1: **撮影レーンをここに取り込んだ**（第2 project）。
  //
  // それまで `e2e/screenshots.spec.ts` は `e2e/` 直下にあり、この config の
  // `testDir: './e2e/specs'` から外れていた。PR #86 でセレクタが壊れたとき、
  // 担当は `e2e/specs/*.spec.ts` を全数 grep して7本直したが、
  // **glob から漏れた撮影レーンだけが壊れたまま `make e2e` 全 green でマージされた。**
  //
  // 対策として `.claude/skills/e2e/reference/limitations.md` に
  // 「セレクタを変えたら `e2e/` 全体を grep する」と書いてあったが、**効かなかった。**
  // 人が思い出すことに賭けるのをやめ、普段回すコマンドに入れる。
  //
  // 「CSS セレクタが実装に存在するかを静的に検査する」案は採らなかった。
  // **PR #86 で壊れたのは入れ子構造（`.tab-bar__tabs > .tab-bar__tab` の間に
  // `.tab-bar__tablist` が挿入された）で、クラス名は両方とも実装に残っている。**
  // 静的検査は PASS を返す = 防ぎたい当の事例を捕まえられない。
  // 加えて誤検知が最良の照合方法でも 12%（@xterm/xterm 所有のクラスは
  // このリポジトリの src にも css にも無いので、恒久的な allowlist が要る）。
  //
  // コストは実測で +12秒 / 163秒 = **+7%**。
  projects: [
    {
      name: 'specs',
      testDir: './e2e/specs',
    },
    {
      // 撮影レーン。**`docs/images/` は書き換えない**（出力先を一時ディレクトリへ
      // 振る。同じコードで2回撮っても全枚数がバイト差になるため、
      // `make e2e` のたびに作業ツリーが汚れてしまう）。
      // README 用の画像を実際に更新するのは `make e2e-screenshots` の側。
      name: 'screenshots',
      testDir: './e2e',
      testMatch: 'screenshots.spec.ts',
      // 撮影は1テストあたりの手数が多く、専用 config は 60 秒を使っている。
      // project 単位で上書きできるので、specs 側の 30 秒とは独立に保てる。
      timeout: 60_000,
    },
  ],
  // Electron のインスタンスを同時に複数立てると PTY とウィンドウ制御が不安定になる
  workers: 1,
  fullyParallel: false,
  // spec ごとに Electron を起動し直すため、1回のフル実行で起動がシナリオ数だけ走る。
  // この回数を繰り返すと稀に起動自体が失敗する（テスト本体とは無関係の一過性クラッシュ）。
  // 実測では数%（2.0% / 6.4% / 3.5% と測るたびに動く。率と根拠は
  // .claude/skills/e2e/operations/run-e2e.md が正）、Electron のプロセスは立つのにウィンドウが出ないまま
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
