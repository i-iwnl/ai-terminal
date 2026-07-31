import { test, expect } from '@playwright/test';
import { launchApp, closeApp, openSettingsWindow, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

/**
 * 設定ウィンドウの開閉と、変更が実際に効くことを検証する。
 *
 * 設定は本体とは別の BrowserWindow（Issue #25 でモーダルから独立ウィンドウへ変えた）。
 * モーダルだった頃は「開いた直後のキー入力が PTY へ流れる」不具合があったが、
 * 別ウィンドウになったことで構造ごと消えている。
 *
 * S21 は config.json をあらかじめ書いた状態で起動して反映を見ているが、
 * こちらは **アプリを起動したまま画面から変えて反映されるか** を見る。
 * config:set の往復と、返ってきた設定での再描画までが対象。
 *
 * フォントサイズを判定材料に選んだのは、xterm の描画に伝わったことが
 * DOM の computed style で確認できるため（色は S21 が見ている）。
 */
test('S31 設定パネルから変更するとターミナルに反映される', async () => {
  const { window } = launched;

  const rows = window.locator('.terminal-pane__container .xterm-rows').first();
  await expect(rows).toBeVisible();
  const before = await rows.evaluate((el) => getComputedStyle(el).fontSize);

  // タブバーの「設定」ボタンで開く（別ウィンドウが現れる）
  const dialog = await openSettingsWindow(launched, () =>
    window.locator('button[aria-label="設定を開く"]').click(),
  );

  // 通知音の一覧が取れていること（macOS のシステムサウンドが読める）。
  // 「OS 既定」だけの環境もありうるので、件数ではなく先頭の選択肢の性質で見る。
  const soundSelect = dialog.locator('select[aria-label="通知音"]');
  await expect(soundSelect).toHaveValue('');

  // フォントサイズを既定（13）と違う値に変える。
  //
  // **`input[type="number"]` の `.first()` で引かないこと。** 数値入力は
  // 「表示 > サイズ」と「動作 > ポーリング間隔(ms)」の2つあり、`.first()` が
  // 前者を指すのは「表示 が最初のセクションだから」という暗黙の DOM 順序への
  // 依存でしかない。セクションを並べ替えるとポーリング間隔のほうに化け、
  // fill('22') が coerceConfig で 500 にクランプされてフォントサイズは 13 のまま、
  // 下の toBe('22px') が 20 秒のタイムアウトで落ちる（原因の分かりにくい壊れ方）。
  //
  // `.settings__row` は <label> が入力欄を内包する形なので、ラベルの文字で引ける。
  const fontSize = dialog.getByLabel('サイズ');
  await fontSize.fill('22');
  await fontSize.blur();

  await expect(async () => {
    const after = await rows.evaluate((el) => getComputedStyle(el).fontSize);
    expect(after).toBe('22px');
  }).toPass({ timeout: 20_000 });
  expect(before).not.toBe('22px');

  // Escape / Cmd+W を押すとウィンドウごと閉じるため、press() 自体が
  // 「ページが閉じた」で reject しうる。閉じたことは windows() の数で判定するので、
  // ここでの reject は握り潰してよい（押せなかった場合は次の assert が落ちる）。
  await dialog.keyboard.press('Escape').catch(() => undefined);
  await expect.poll(() => launched.app.windows().length, { timeout: 15_000 }).toBe(1);

  // Cmd+, で開き直すと、変更した値が保持されている
  const reopened = await openSettingsWindow(launched, () => window.keyboard.press('Meta+,'));
  await expect(reopened.getByLabel('サイズ')).toHaveValue('22');

  // Cmd+W でも閉じる（設定ウィンドウ側のキー処理）
  await reopened.keyboard.press('Meta+w').catch(() => undefined);
  await expect.poll(() => launched.app.windows().length, { timeout: 15_000 }).toBe(1);
});
