import { test, expect } from '@playwright/test';
import { launchApp, closeApp, openSettingsWindow, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

/** `src/shared/screen-reader-mode.ts` の `DETECTED_NOTICE_TEXT` と一致していること。 */
const NOTICE = 'いま有効です。VoiceOver などの支援技術を検知しています';

/**
 * Issue #149（後半）: 支援技術の状態を**全ウィンドウへ配る**。
 *
 * 直す前の `registerAccessibilityHandlers(win)` は登録時のウィンドウを閉包で掴み、
 * `accessibility-support-changed` を**本体ウィンドウ1枚にしか送っていなかった**。
 * そのため設定ウィンドウを開いたまま支援技術を起動しても、表示が追従しない。
 *
 * ⚠ **`S99` とは向きが違う。** あちらは検知フラグを**開く前**に立てて
 * 「開いた時点の値が出るか」を見る（`SettingsWindow` のマウント時 `invoke` の担当）。
 * こちらは**開いたまま**立てて「イベントが届くか」を見る。
 * 片方だけだと、もう片方の経路を壊しても緑のままになる。
 *
 * ⭐ この spec は**本体ウィンドウ側の追従**も同時に見る。`.xterm-accessibility` は
 * 実効値が有効になったときだけ生える DOM で、**自動検知の経路にはこれまで
 * E2E が1本も無かった**（S37 は `config.screenReaderMode: true` の経路だけ）。
 */
test('S100 設定ウィンドウを開いたまま支援技術を検知しても、表示と読み上げ用 DOM が追従する', async () => {
  const { app, window } = launched;

  // 先に設定ウィンドウを開く（この時点では検知していない）。
  const settings = await openSettingsWindow(launched, () =>
    window.locator('button[aria-label="設定を開く"]').click(),
  );
  await settings.waitForLoadState('domcontentloaded');

  const notice = settings.locator('#settings-screen-reader-detected');
  await expect(notice).toHaveText('');
  // 本体ウィンドウ側も、この時点では読み上げ用 DOM が無い。
  await expect(window.locator('.xterm-accessibility')).toHaveCount(0);

  // **開いたまま**支援技術を検知した状態にする。
  await app.evaluate(({ app: electronApp }) => {
    electronApp.accessibilitySupportEnabled = true;
  });

  // 設定ウィンドウ（イベントの新しい宛先）が追従する。
  await expect(notice).toHaveText(NOTICE);
  // 本体ウィンドウ（元からの宛先）も壊れていない。**自動検知で読み上げ用 DOM が生える。**
  await expect(window.locator('.xterm-accessibility')).toHaveCount(1);
});
