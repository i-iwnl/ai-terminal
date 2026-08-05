import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';
import { captureRegionStats } from '../fixtures/pixels';

/**
 * Issue #167（Issue #179 の周4）。
 *
 * このアプリは**全タブ・全ペインを同時にマウントしたまま**（`visibility` だけで
 * 切り替える）ので、**WebGL コンテキストがペイン数ぶん同時に生きる**。
 * Chromium の1レンダラあたりの上限は16前後で、超えると古いものから黙って失われる。
 *
 * 失ったまま放置すると、**そのペインは真っ白なキャンバスになるが a11y の DOM は
 * 生き残る**。支援技術には読めていて、**晴眼の利用者にだけ主コンテンツが消える**、
 * という珍しい向きの壊れ方をする。
 *
 * ## このシナリオが見るもの
 *
 * `WebglAddon` は `webglcontextlost` を受けてから**3秒**待ち（`webglcontextrestored`
 * を待つ猶予。`WebglRenderer.ts`）、復帰しなければ `onContextLoss` を発火する。
 * そこで `dispose()` すると、xterm がコアの既定レンダラ（DOM）へ差し替えて
 * `handleResize` まで行う（`WebglAddon.activate` の `toDisposable`）。
 *
 * ⛔ **canvas が消えたことだけを見ない。** 見るのは**文字が DOM に戻ってくること**。
 * それが利用者にとっての「消えていない」の中身で、canvas の有無はその手段でしかない。
 *
 * > **GPU を有効にして起動する**（S23 と同じ）。他のシナリオは `--disable-gpu` で
 * > 最初から DOM レンダラなので、このシナリオは成立しない。
 */

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp({ gpu: true });
});

test.afterEach(async () => {
  await closeApp(launched);
});

test('S94 WebGL コンテキストを失ってもターミナルの文字が消えず、DOM レンダラへ落ちる', async () => {
  const { window, app } = launched;

  const pane = window.locator('.terminal-pane__container').first();
  await expect(pane).toBeVisible();

  // --- 1. WebGL レンダラで動いていることを先に固定する ------------------------
  //
  // ここを確かめずに進むと、GPU が使えない環境（最初から DOM レンダラ）でも
  // 「文字が DOM にある」が通ってしまい、**何も検証しない spec になる**。
  const canvas = window.locator('.terminal-pane__container .xterm-screen canvas').first();
  await expect(
    canvas,
    'canvas が無い = 最初から DOM レンダラ。この環境ではこのシナリオは成立しない',
  ).toBeAttached();

  // `.xterm-rows` は DOM レンダラが持つ要素で、**WebGL レンダラでは存在しない**。
  // この非存在が、あとで「戻ってきた」と言えることの前提になる。
  const rows = window.locator('.terminal-pane__container .xterm-rows').first();
  await expect(
    rows,
    'WebGL レンダラなのに .xterm-rows がある = 前提が崩れている（既に DOM レンダラ）',
  ).toHaveCount(0);

  // シェルのプロンプトが**バッファに入るまで**待つ。WebGL では DOM に文字が
  // 出ないので、S23 と同じく描画されたピクセルで待つ。
  // ここを待たずに失わせると、DOM レンダラへ落ちた先に描くものが無く、
  // 「文字が戻ってこない」のか「そもそも出ていない」のかを分けられない。
  const box = await pane.boundingBox();
  expect(box, 'ターミナル領域の矩形を取得できない').not.toBeNull();
  if (!box) return;
  await expect
    .poll(async () => (await captureRegionStats(app, box)).nonBackground, {
      message: 'ターミナル領域が単色のまま = まだ何も描画されていない',
      timeout: 20_000,
    })
    .toBeGreaterThan(0);

  // --- 2. コンテキストを意図的に失わせる --------------------------------------
  //
  // 本番の失われ方（コンテキスト数の上限超過）はペインを16枚以上開かないと
  // 起きず、E2E で作るには重すぎる。`WEBGL_lose_context` は Chromium が
  // 同じ `webglcontextlost` を発火させるための標準拡張で、**アドオンから見た
  // 経路は本番と同じ**。
  // ⛔ **`canvas` の1枚目を掴まない。** `.xterm-screen` の中には
  // `.xterm-link-layer`（2D コンテキスト）が**先に**並んでいて、1枚目を取ると
  // `getContext('webgl2')` が null を返す（実測。最初この形で書いて空振りした）。
  // **WebGL コンテキストを持つ1枚**を探し当てる。
  const lost = await window.evaluate(() => {
    const all = Array.from(
      document.querySelectorAll<HTMLCanvasElement>('.terminal-pane__container .xterm-screen canvas'),
    );
    if (all.length === 0) return 'canvas が1枚も無い';
    for (const el of all) {
      const gl = el.getContext('webgl2') ?? el.getContext('webgl');
      if (!gl) continue;
      const ext = gl.getExtension('WEBGL_lose_context');
      if (!ext) return 'WEBGL_lose_context 拡張が無い';
      ext.loseContext();
      return 'ok';
    }
    return `WebGL コンテキストを持つ canvas が無い（${all.length}枚あるが全部 2D）`;
  });
  expect(lost, 'コンテキストを失わせられなければ、このシナリオは何も検証していない').toBe('ok');

  // --- 3. 文字が DOM に戻ってくる ---------------------------------------------
  //
  // アドオンの3秒の猶予 + 差し替え後の再描画を待つ。
  // `onContextLoss` を購読していないと、ここは**永久に空のまま**になる
  // （キャンバスは白いまま生き続け、画面から文字が消える）。
  await expect(
    window.locator('.terminal-pane__container .xterm-rows').first(),
    'WebGL コンテキストを失ったあと、文字が DOM に戻ってきていない = ' +
      '晴眼の利用者にだけ画面が消えている（onContextLoss を購読していない）',
  ).toContainText(/[$%#>]/, { timeout: 20_000 });

  // 差し替わったので canvas は残っていない（手段の側の確認）。
  await expect(
    window.locator('.terminal-pane__container .xterm-screen canvas'),
    'DOM レンダラへ差し替わったなら WebGL の canvas は残らない',
  ).toHaveCount(0);
});
