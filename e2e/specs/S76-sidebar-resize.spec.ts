import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

/**
 * Issue #119 の周4（#20 の PR 16）。サイドバーのドラッグリサイズと幅の永続化。
 *
 * ## 1. 関門: ドラッグ中は `pty:resize` が飛ばない
 *
 * `.sidebar` の幅を実際に書き換えると `.terminal-stack` の実ピクセル寸法が変わり、
 * `ResizeObserver -> fitAddon.fit() -> pty.resize() -> node-pty の TIOCSWINSZ
 * -> SIGWINCH` まで連鎖する。しかも**全タブの TerminalPane が同時にマウントされ、
 * 非表示タブも `visibility: hidden` でレイアウトを持つ**ため
 * `clientWidth === 0` のガードを通過する（タブ10枚なら 1px 動かすたびに 10 回）。
 *
 * `PaneSplitterHandle.tsx` が確立した**ゴースト方式**（`position: fixed` の線だけを
 * 動かし、実レイアウトは `mouseup` で1回だけ変える）を使う。S59 が同じ関門を
 * ペインのスプリッタで固定しており、この spec はそのサイドバー版。
 *
 * ## 2. 折りたたみ（#118 / S72）を壊していないこと
 *
 * **幅を `style={{ width }}` で渡すと、この spec が守っている折りたたみが黙って壊れる。**
 * インラインスタイル（詳細度 1,0,0,0）は `.sidebar.is-collapsed { width: 0 }`（0,2,0）に
 * **必ず勝つ**ため。`--sidebar-width` カスタムプロパティ経由なら `width` の宣言同士の
 * 後勝ちになり、`.is-collapsed` が生きる。
 *
 * S72 は「既定幅で畳める」ことしか見ていないので、**幅を変えたあとに畳めるか**は
 * ここで見る（S72 を通しただけでは、この壊れ方は検出できない）。
 *
 * ## 3. ドラッグの代替手段（WCAG 2.5.7 Dragging Movements）
 *
 * 「表示」メニューの `サイドバーを広げる / 狭める / 幅を既定に戻す`。
 * **アクセラレータは持たせない**（`分割比を広げる/狭める/50%に戻す` と同じ形。
 * 幅調整は頻度が低く、`Cmd+英数字` の名前空間を消費する価値が無い）。
 */

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

/**
 * Main プロセス側に `pty:resize` のカウンタを仕込む（S59 と同じ手法）。
 *
 * `evaluate` に渡す関数は Main プロセスでシリアライズして実行されるため、
 * このファイルの外側のスコープを一切参照できない。チャンネル名だけを引数で渡す。
 */
async function installResizeCounter(app: LaunchedApp['app'], channel: string): Promise<void> {
  await app.evaluate(({ ipcMain }, ch) => {
    const g = globalThis as unknown as { __e2eResizeCount?: number };
    g.__e2eResizeCount = 0;
    ipcMain.on(ch, () => {
      g.__e2eResizeCount = (g.__e2eResizeCount ?? 0) + 1;
    });
  }, channel);
}

async function readResizeCount(app: LaunchedApp['app']): Promise<number> {
  return app.evaluate(() => {
    const g = globalThis as unknown as { __e2eResizeCount?: number };
    return g.__e2eResizeCount ?? 0;
  });
}

async function sidebarWidth(app: LaunchedApp): Promise<number> {
  const box = await app.window.locator('.sidebar').boundingBox();
  if (!box) throw new Error('.sidebar の boundingBox が取得できなかった');
  return Math.round(box.width);
}

test('S76 サイドバーをドラッグで広げられ、ドラッグ中は pty:resize が飛ばない', async () => {
  const { window, app } = launched;

  const screen = window.locator('.terminal-pane__container .xterm-screen').first();
  await expect(screen).toContainText(/[$%#>]/, { timeout: 20_000 });

  expect(await sidebarWidth(launched), '既定幅').toBe(260);

  const handle = window.locator('.sidebar__resize-handle');
  await expect(handle).toHaveCount(1);
  // ARIA。ドラッグ以外から幅が読めること（Tab では到達できないが、
  // メニューから `.focus()` されたときに読み上げられる必要がある）。
  await expect(handle).toHaveAttribute('role', 'separator');
  await expect(handle).toHaveAttribute('aria-orientation', 'vertical');
  await expect(handle).toHaveAttribute('aria-valuenow', '260');
  await expect(handle).toHaveAttribute('aria-valuetext', '260 ピクセル');

  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error('ハンドルの boundingBox が取得できなかった');
  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;

  await installResizeCounter(app, 'pty:resize');

  // --- ドラッグ中 -------------------------------------------------------------
  await window.mouse.move(startX, startY);
  await window.mouse.down();
  // 1回の大きな移動ではなく刻んで動かす（実際の操作に近く、
  // 「毎フレーム resize が飛ぶ」実装なら確実に検出できる）。
  for (let i = 1; i <= 10; i += 1) {
    await window.mouse.move(startX + i * 6, startY);
  }

  // **幅はまだ変わっていない**（ゴーストだけが動いている）。
  expect(await sidebarWidth(launched), 'ドラッグ中は実レイアウトを変えない').toBe(260);
  // ゴースト線が出ていること。
  await expect(window.locator('.sidebar__resize-ghost')).toHaveCount(1);
  expect(await readResizeCount(app), 'ドラッグ中に pty:resize が飛んではいけない').toBe(0);

  // --- mouseup ---------------------------------------------------------------
  await window.mouse.up();

  await expect(window.locator('.sidebar__resize-ghost')).toHaveCount(0);
  const widened = await sidebarWidth(launched);
  expect(widened, '離した位置ぶんだけ広がる').toBe(320);
  await expect(handle).toHaveAttribute('aria-valuenow', '320');

  // mouseup 後は飛んでよい（飛ばないとターミナルの桁数が実寸とずれる）。
  await expect
    .poll(async () => readResizeCount(app), { timeout: 10_000 })
    .toBeGreaterThan(0);

  // --- 幅を変えても畳める（#118 / S72 を壊していない） -------------------------
  // **`style={{ width }}` で渡していると、ここが必ず落ちる。**
  await window.keyboard.press('Meta+Alt+s');
  await expect(window.locator('.sidebar')).toHaveClass(/is-collapsed/);
  expect(await sidebarWidth(launched), '畳んだら幅0').toBe(0);

  await window.keyboard.press('Meta+Alt+s');
  await expect(window.locator('.sidebar')).not.toHaveClass(/is-collapsed/);
  expect(await sidebarWidth(launched), '開き直したら自分で決めた幅に戻る').toBe(widened);
});
