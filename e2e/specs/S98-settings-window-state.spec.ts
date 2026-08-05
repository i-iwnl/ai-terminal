import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, closeApp, openSettingsWindow, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

/** 設定ウィンドウは幅 520 固定（minWidth === maxWidth）なので、それで見分ける。 */
const SETTINGS_WIDTH = 520;

/**
 * Issue #153: 設定ウィンドウの位置と高さを復元する。
 *
 * 直す前は `openSettingsWindow()` が `new BrowserWindow({ width: 520, height: 640 })` と
 * リテラル固定で作っており、閉じて開き直すたびに既定へ戻っていた
 * （実測: 開き直したウィンドウは `{ x: 460, y: 130, height: 640 }`）。
 *
 * **横幅は保存対象にしない。** `minWidth === maxWidth === 520` で仕様として固定されている。
 *
 * ⚠ **順序に意味がある。** 保存先は `window-state.json` 1ファイルで、書き手が
 * 本体ウィンドウと設定ウィンドウの2つある。消し合いは**双方向**なので、
 * 片方向しか踏まない順序で書くと**もう片方を壊しても緑のまま**になる
 * （初版が実際にそうだった: 設定を閉じるときの保存が、本体の保存で消えたキーを
 * 書き戻してしまい「本体が設定を消す」向きを検出できなかった）。
 *
 * | 段 | 何を踏むか |
 * |---|---|
 * | 本体を動かす -> 設定を動かして閉じる -> **ファイルを見る** | 設定の保存が**本体を消していない** |
 * | そのあと本体を動かす -> 設定を開き直す | 本体の保存が**設定を消していない** |
 *
 * ⚠ **`move` イベントは E2E では飛ばない。** 隠したウィンドウに `setBounds()` を
 * 当てると macOS では `resize` だけが発火する（実測。`move` は 0 回）。
 * ドラッグでの移動（`move` 側）が保存されることは、この spec では担保できない
 * -> `.claude/skills/e2e/reference/limitations.md`
 */
test('S98 設定ウィンドウを動かして閉じ、開き直すと同じ位置と高さで出る', async () => {
  const { app, window, home } = launched;
  const statePath = join(home, '.ai-terminal', 'window-state.json');
  const readState = (): Record<string, unknown> =>
    JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, unknown>;

  const setBounds = (bounds: Record<string, number>, target: 'main' | 'settings'): Promise<void> =>
    app.evaluate(
      async ({ BrowserWindow }, { rect, width, wantSettings }) => {
        const win = BrowserWindow.getAllWindows().find((w) =>
          wantSettings ? w.getBounds().width === width : w.getBounds().width !== width,
        );
        win?.setBounds(rect);
        // 保存は 400ms デバウンス。
        await new Promise((r) => setTimeout(r, 700));
      },
      { rect: bounds, width: SETTINGS_WIDTH, wantSettings: target === 'settings' },
    );

  // 1. 本体ウィンドウを動かす。
  await setBounds({ x: 120, y: 90, width: 900, height: 700 }, 'main');

  // 2. 設定ウィンドウを開いて、既定とは明確に違う位置・高さへ動かす。
  const settings = await openSettingsWindow(launched, () =>
    window.locator('button[aria-label="設定を開く"]').click(),
  );
  await settings.waitForLoadState('domcontentloaded');
  await setBounds({ x: 317, y: 211, height: 701 }, 'settings');

  // 3. 閉じる（close でも保存される）。
  await app.evaluate(({ BrowserWindow }, width) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.getBounds().width === width)
      ?.close();
  }, SETTINGS_WIDTH);
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), {
      timeout: 10_000,
    })
    .toBe(1);

  // 4. **設定の保存が本体のキーを消していない**こと。ここで見ないと、
  //    あとで本体をもう一度動かした時点で上書きされ、永久に検出できない。
  const afterSettingsSaved = readState();
  expect(afterSettingsSaved.x).toBe(120);
  expect(afterSettingsSaved.y).toBe(90);
  expect(afterSettingsSaved.width).toBe(900);
  expect(afterSettingsSaved.height).toBe(700);

  // 5. 設定を閉じたあとに本体を動かす。**1回目と違う値にする**
  //    （同じ値だと `resize` が飛ばず、保存経路を通らない）。
  await setBounds({ x: 140, y: 110, width: 920, height: 720 }, 'main');

  // 6. 開き直すと、設定ウィンドウが同じ位置・高さで出ること。
  const reopened = await openSettingsWindow(launched, () =>
    window.locator('button[aria-label="設定を開く"]').click(),
  );
  await reopened.waitForLoadState('domcontentloaded');

  const restored = await app.evaluate(({ BrowserWindow }, width) => {
    const settingsWin = BrowserWindow.getAllWindows().find((w) => w.getBounds().width === width);
    return settingsWin ? settingsWin.getBounds() : null;
  }, SETTINGS_WIDTH);

  expect(restored).not.toBeNull();
  expect(restored?.x).toBe(317);
  expect(restored?.y).toBe(211);
  expect(restored?.height).toBe(701);
  // 横幅は保存対象ではないので、常に 520 のまま。
  expect(restored?.width).toBe(SETTINGS_WIDTH);

  // 7. 本体の2回目の保存も残っていること。
  const finalState = readState();
  expect(finalState.x).toBe(140);
  expect(finalState.width).toBe(920);

  // 8. **いまのディスプレイ構成で見えない位置は捨てる**（外部ディスプレイを外した状態）。
  //    位置だけ落として高さは活かす、が本体ウィンドウと同じ扱い。
  await setBounds({ x: 9000, y: 9000, height: 555 }, 'settings');
  const offScreenSaved = readState().settings as Record<string, unknown>;
  // OS がクランプすることがあるので、保存された値そのものを前提にしない。
  // 「保存された位置がどのディスプレイにも掛かっていない」ことだけを条件にする。
  const displays = await app.evaluate(({ screen }) =>
    screen.getAllDisplays().map((d) => d.bounds),
  );
  const savedX = offScreenSaved.x as number;
  const onSomeDisplay = displays.some((b) => savedX < b.x + b.width && savedX + 520 > b.x);
  test.skip(onSomeDisplay, 'OS が座標をクランプしたため、画面外の条件を作れなかった');

  await app.evaluate(({ BrowserWindow }, width) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.getBounds().width === width)
      ?.close();
  }, SETTINGS_WIDTH);
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), {
      timeout: 10_000,
    })
    .toBe(1);

  const recovered = await openSettingsWindow(launched, () =>
    window.locator('button[aria-label="設定を開く"]').click(),
  );
  await recovered.waitForLoadState('domcontentloaded');
  const recoveredBounds = await app.evaluate(({ BrowserWindow }, width) => {
    const settingsWin = BrowserWindow.getAllWindows().find((w) => w.getBounds().width === width);
    return settingsWin ? settingsWin.getBounds() : null;
  }, SETTINGS_WIDTH);

  // 位置は捨てられている（Electron が中央に置く）が、高さは活きている。
  expect(recoveredBounds?.x).not.toBe(savedX);
  expect(recoveredBounds?.height).toBe(555);
});
