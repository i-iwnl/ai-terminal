import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';
import { captureRegionStats } from '../fixtures/pixels';

let launched: LaunchedApp;

test.beforeEach(async () => {
  // このシナリオだけ GPU を有効にする（他は --disable-gpu で DOM レンダラになる）。
  launched = await launchApp({ gpu: true });
});

test.afterEach(async () => {
  await closeApp(launched);
});

test('S23 GPU 有効時に WebGL レンダラで実際に描画される', async () => {
  const { app, window } = launched;

  const pane = window.locator('.terminal-pane__container').first();
  await expect(pane).toBeVisible();

  // 1. WebGL レンダラになっていること。
  //    ここを確かめずにピクセルだけ見ると、DOM レンダラへフォールバックした状態でも
  //    green になってしまい、このシナリオの存在意義が消える。
  const canvas = window.locator('.terminal-pane__container .xterm-screen canvas').first();
  await expect(
    canvas,
    'canvas が無い = WebGL レンダラになっていない。GPU が使えない環境では ' +
      'アプリが DOM レンダラにフォールバックするため、このシナリオは成立しない',
  ).toBeAttached();

  // 2. その canvas に実際にピクセルが描かれていること。
  //    xterm.css を読み込み忘れると canvas が正しく配置されず、
  //    シェルのプロンプトが出ているのに画面は単色のままになる。
  const box = await pane.boundingBox();
  expect(box, 'ターミナル領域の矩形を取得できない').not.toBeNull();
  if (!box) return;

  // シェルの起動を待つ意味も兼ねて、何か描かれるまでポーリングする
  // （WebGL では DOM にテキストが出ないので、プロンプト文字列では待てない）。
  //
  // この判定は弱い。描画が完全に壊れていてもカーソルのブロックだけは描かれるため、
  // ここは「起動が進んだ」ことの確認どまりになる。描画の本体は下の 3 で見る。
  await expect
    .poll(async () => (await captureRegionStats(app, box)).nonBackground, {
      message: 'ターミナル領域が完全な単色のまま = カーソルすら描画されていない',
      timeout: 20_000,
    })
    .toBeGreaterThan(0);

  // 3. 文字を入力し、描画されたピクセルが増えること。
  //    これが本命の判定。xterm.css を読み込み忘れると canvas が正しく配置されず、
  //    シェルにはコマンドが届いているのに画面には何も出ない状態になる
  //    （実際にその不具合があり、DOM レンダラで走る他の22シナリオは緑のままだった）。
  //    ピクセル数の絶対値ではなく増分を見るので、フォントや解像度に依存しない。
  const before = await captureRegionStats(app, box);

  await window.locator('.xterm-helper-textarea').first().focus();
  await window.keyboard.type('echo webgl-e2e', { delay: 30 });

  await expect
    .poll(async () => (await captureRegionStats(app, box)).nonBackground, {
      message:
        '入力した文字が描画されていない。入力が PTY に届いていないのではなく、' +
        'WebGL レンダラが描画できていない可能性が高い（xterm.css の読み込み漏れを疑うこと）',
      timeout: 10_000,
    })
    .toBeGreaterThan(before.nonBackground);
});
