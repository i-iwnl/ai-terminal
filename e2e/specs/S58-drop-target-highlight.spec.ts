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
 * Issue #56 PR 6: ドロップ可能領域のハイライト（design-review.md 提案 H・T1の回収）。
 *
 * 分割で複数ペインが並ぶと「ファイルをドラッグしたときどこに落ちるか」が画面から
 * 分からなかった。design-review が指定する実装は次の3点:
 *
 * 1. カーソル下のペインにだけ `box-shadow: inset 0 0 0 2px var(--accent)` の
 *    **4辺の枠**を出す。アクティブ線（上辺1本、`.terminal-pane.is-active` の
 *    `box-shadow: inset 0 1px 0`）とは**形**（スプレッド半径の有無）で区別する。
 *    同じ --accent で辺の本数だけ違う設計であって、色で区別しているわけではない。
 * 2. `dragleave` は xterm の canvas 等の子要素へ入るたびに発火するので、
 *    素朴に「dragleave で消す」と実装するとペイン内でカーソルを動かしただけで
 *    枠が消えてしまう。カウンタで管理し、0に戻ったときだけ消す。
 * 3. `drop` でも必ず消す（dragleave を経ずに drop する経路でカウンタが
 *    残ったままにならないこと）。
 *
 * 合成 DataTransfer で dragenter/dragleave/drop を発火させる
 * （`S42-drop-path.spec.ts` が使っている「合成 DataTransfer で drop を検証する」
 * 手法を dragenter/dragleave にも広げたもの。webUtils 由来の File を使わない
 * 経路なので E2E から再現できる）。
 *
 * 同じ合成ドラッグの最中に発火する複数のイベントなので、DataTransfer インスタンスを
 * `window.__s58Dt` に控えて複数回の evaluate をまたいで使い回す。各段階の
 * クラス付与は React の再レンダリングを待つ必要があるため、即時の evaluate 内
 * 判定ではなく `expect(locator).toHaveClass(...)`（自動リトライ）で見る。
 */
test('S58 分割時、カーソル下のペインにだけ4辺のドロップ枠が出て、子要素をまたいでも消えない', async () => {
  const { window, workDir } = launched;

  const cwdName = workDir.split('/').pop() as string;
  const promptPattern = new RegExp(`${cwdName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[%#]`);

  const panes = window.locator('.terminal-pane');
  const activeScreen = window.locator('.terminal-pane.is-active .xterm-screen');

  // シェルのプロンプトが出てから分割する（S56/S57 と同じ前提）。
  await expect(activeScreen).toContainText(promptPattern, { timeout: 20_000 });

  // --- Cmd+D: 右に分割。以後 .terminal-pane.is-active でないほうを
  //     「カーソルがドラッグしているペイン」として使う ------------------------
  await window.keyboard.press('Meta+d');
  await expect(panes).toHaveCount(2);
  await expect(activeScreen).toContainText(promptPattern, { timeout: 20_000 });

  const dropPane = window.locator('.terminal-pane:not(.is-active)');
  const otherPane = window.locator('.terminal-pane.is-active');
  const dropPaneChild = dropPane.locator('.terminal-pane__container');
  const dropFrameClass = /terminal-pane--drop-target/;

  // 開始時点では、まだドラッグしていないのでどちらにも枠は付かない。
  await expect(dropPane).not.toHaveClass(dropFrameClass);
  await expect(otherPane).not.toHaveClass(dropFrameClass);

  // 合成 DataTransfer を用意し、以後の全イベントで使い回す
  // （中身は空でよい。枠の表示/非表示だけを見るテストであり、drop 後に PTY へ
  // 実際の文字列が送られると後続の操作に影響が出る。text/uri-list という種別
  // 自体は setData で登録されるので、既存の isFileDrag 判定は通る）。
  await window.evaluate(() => {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/uri-list', '');
    (window as unknown as { __s58Dt: DataTransfer }).__s58Dt = dataTransfer;
  });

  async function fire(type: string, locator: typeof dropPane): Promise<void> {
    await locator.evaluate((el, evtType) => {
      const dataTransfer = (window as unknown as { __s58Dt: DataTransfer }).__s58Dt;
      el.dispatchEvent(new DragEvent(evtType, { dataTransfer, bubbles: true, cancelable: true }));
    }, type);
  }

  // --- 関門1: カーソル下のペインにだけ枠が出る（もう一方には出ない） -----------
  await fire('dragenter', dropPane);
  await expect(dropPane, 'dragenter でカーソル下のペインに枠が付く').toHaveClass(dropFrameClass);
  await expect(otherPane, 'カーソル下でないペインには枠が付かない').not.toHaveClass(dropFrameClass);

  // --- 関門2: dragleave はカウンタで管理し、子要素をまたいでも消えない --------
  // xterm の canvas 等、子要素へ入り直す（同じペイン内で子要素をまたぐ動き）。
  await fire('dragenter', dropPaneChild);
  await expect(dropPane, '子要素へ入り直しても枠は付いたまま').toHaveClass(dropFrameClass);

  // 子要素から出る。カウンタは 2 -> 1 のはずなので、まだ消えない。
  await fire('dragleave', dropPaneChild);
  await expect(
    dropPane,
    '子要素からの dragleave だけでは枠が消えない（カウンタが1残っているはず）',
  ).toHaveClass(dropFrameClass);

  // ペイン自体から出る。カウンタは 1 -> 0 のはずなので、ここで消える。
  await fire('dragleave', dropPane);
  await expect(
    dropPane,
    'ペイン自体からの dragleave でカウンタが0に戻り枠が消える',
  ).not.toHaveClass(dropFrameClass);

  // --- 関門3: drop は dragleave を経なくても必ず枠を消す -----------------------
  await fire('dragenter', dropPane);
  await expect(dropPane, 'drop 前は枠が付いている').toHaveClass(dropFrameClass);
  await fire('drop', dropPane);
  await expect(dropPane, 'drop の後は必ず枠が消える').not.toHaveClass(dropFrameClass);

  // --- 関門4: アクティブ線（上辺1本）とドロップ枠（4辺）が形で区別できる --------
  // ドロップ枠は spread radius 2px を持つ（4辺に均等に広がる=形が枠になる）。
  // アクティブ線は offset-y 1px・spread radius 0 で、上辺だけに出る線のまま
  // （other 側は一度もドラッグ対象になっていないので、素の「アクティブ表現のみ」
  // の box-shadow を測れている）。
  await fire('dragenter', dropPane);
  await expect(dropPane).toHaveClass(dropFrameClass);
  const dropFrameBoxShadow = await dropPaneChild.evaluate((el) => getComputedStyle(el).boxShadow);
  const activeLineBoxShadow = await otherPane
    .locator('.terminal-pane__container')
    .evaluate((el) => getComputedStyle(el).boxShadow);

  expect(dropFrameBoxShadow).toMatch(/2px/);
  expect(activeLineBoxShadow).toMatch(/1px/);
  expect(activeLineBoxShadow).not.toMatch(/2px/);
  expect(
    dropFrameBoxShadow,
    'ドロップ枠とアクティブ線の box-shadow は同じ形ではない',
  ).not.toBe(activeLineBoxShadow);
});
