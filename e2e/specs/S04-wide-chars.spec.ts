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
 * 文字幅の検証方法:
 *
 * このアプリは @xterm/addon-unicode-graphemes を有効化しており（useTerminal.ts）、
 * 全角文字（日本語・絵文字）はセル幅2、半角文字はセル幅1として描画されるはずである。
 * DOM レンダラ（--disable-gpu によるフォールバック）では、xterm.js は同じスタイルが
 * 連続する文字ラン単位で <span> を分割して描画する。全角/半角の境界でも
 * セル幅（描画コストの単位）が変わるため、境界でスタイルラン（span）が分かれる。
 *
 * そこで「半角2文字 + 全角2文字 + 半角2文字」を1行に出力し、実際に3つの span に
 * 分かれること、かつ全角2文字の span の実測ピクセル幅が、半角2文字の span の幅の
 * およそ2倍になっていることを boundingBox() で検証する。
 * セル幅がきっちり2倍でない場合でも「全角が半角の1倍ではなく2倍に近い」ことが
 * わかれば文字幅ずれ（=グラフェム処理が効いていない状態）を検出できる。
 *
 * 限界: これは「xterm.js が全角文字をダブル幅セルとして扱っているか」を担保するもので、
 * 実際のグリフのレンダリング品質（フォントのメトリクス崩れなど）までは検証しない。
 */
test('S04 日本語と絵文字を含む出力で文字幅がずれない', async () => {
  const { window } = launched;

  const screen = window.locator('.terminal-pane__container .xterm-screen').first();
  await expect(screen).toContainText(/[$%#>]/, { timeout: 20_000 });

  await window.locator('.xterm-helper-textarea').first().focus();

  // まず日本語・絵文字が単純に画面へ現れることを確認する。
  await window.keyboard.type('echo 日本語テスト🎉');
  await window.keyboard.press('Enter');
  await expect(screen).toContainText('日本語テスト🎉', { timeout: 10_000 });

  // 文字幅比較用: 半角(AB) + 全角(日本) + 半角(CD) の1行を出力する。
  await window.keyboard.type('echo AB日本CD');
  await window.keyboard.press('Enter');

  // 注意: コマンドを打った直後（Enter 前）にも入力エコー行に "AB日本CD" という
  // 部分文字列が現れてしまう（`echo AB日本CD` というコマンド文字列自体に含まれるため）。
  // screen 全体への toContainText だけでは「実行結果の行」が既に描画されたかを
  // 保証できないので、行のテキストが完全一致で "AB日本CD" になる行（=コマンドの
  // エコー行ではなく出力行そのもの）が現れるまで明示的に待つ。
  const outputRow = window
    .locator('.terminal-pane__container .xterm-rows > div')
    .filter({ hasText: /^AB日本CD$/ });
  await expect(outputRow).toHaveCount(1, { timeout: 10_000 });

  // 出力行（コマンドのエコー行ではなく実行結果行）を span 単位で見る。
  // xterm.js は同一セル幅・同一スタイルの連続文字を1つの span にまとめるため、
  // 半角/全角の境界で span が分割される。
  const spans = outputRow.locator('span');
  await expect(spans).toHaveCount(3);

  const [halfWidthLeft, fullWidth, halfWidthRight] = await Promise.all([
    spans.nth(0).boundingBox(),
    spans.nth(1).boundingBox(),
    spans.nth(2).boundingBox(),
  ]);

  expect(halfWidthLeft).not.toBeNull();
  expect(fullWidth).not.toBeNull();
  expect(halfWidthRight).not.toBeNull();

  // 各 span は2文字ずつなので、1文字あたりの幅で比較する。
  const halfWidthPerChar = (halfWidthLeft!.width + halfWidthRight!.width) / 2 / 2;
  const fullWidthPerChar = fullWidth!.width / 2;

  // 全角は半角のおよそ2倍幅（許容誤差込みで 1.7〜2.3 倍の範囲）であることを確認する。
  const ratio = fullWidthPerChar / halfWidthPerChar;
  expect(ratio).toBeGreaterThan(1.7);
  expect(ratio).toBeLessThan(2.3);
});
