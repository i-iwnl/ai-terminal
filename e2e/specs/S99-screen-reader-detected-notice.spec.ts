import { test, expect } from '@playwright/test';
import { launchApp, closeApp, openSettingsWindow, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

/** 設定ウィンドウは幅 520 固定なので、それで見分ける（S98 と同じ手）。 */
const SETTINGS_WIDTH = 520;

/** `src/shared/screen-reader-mode.ts` の `DETECTED_NOTICE_TEXT` と一致していること。 */
const NOTICE = 'いま有効です。VoiceOver などの支援技術を検知しています';

/** チェックボックスの可視ラベル。**アクセシブル名がこれと完全一致すること**を見る。 */
const CHECKBOX_LABEL = 'ターミナルの内容をスクリーンリーダーから読めるようにする';

async function closeSettings(app: LaunchedApp['app']): Promise<void> {
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
}

/**
 * Issue #149: 支援技術を検知しているとき、設定ウィンドウにそれを出す。
 *
 * **直す前は、設定と実効値の食い違いが画面のどこにも出ていなかった。**
 * VoiceOver を使っている人の画面では「チェックが外れているのに読み上げ用 DOM が
 * 生えている」状態で、「なぜか描画が重い」と感じた人が原因に辿り着けない。
 *
 * ⭐ **検知状態は E2E から作れる。** `app.accessibilitySupportEnabled = true` を
 * `app.evaluate` から代入でき、`accessibility-support-changed` も実際に発火する
 * （2026-08-05 実測）。VoiceOver は要らない。
 *
 * ⚠ **先に「出ていない」ことを assert する。** これが無いと、
 * **常に出す実装でも green** になる（この spec が意味を持つ条件を、同じ spec の
 * 中で作っている）。
 *
 * ⚠ **この spec では検知フラグを「設定ウィンドウを開く前」に立てる。**
 * 開いたまま切り替えても届くこと（追従）は `src/main/accessibility.ts` の
 * 送信先を広げる別の変更の担当で、そちらは `S100` が見る。
 */
test('S99 支援技術を検知しているときだけ、設定に「いま有効です」が出る', async () => {
  const { app, window } = launched;

  // --- 1. 検知していない状態（既定）では出ない ---
  const settings = await openSettingsWindow(launched, () =>
    window.locator('button[aria-label="設定を開く"]').click(),
  );
  await settings.waitForLoadState('domcontentloaded');

  const notice = settings.locator('#settings-screen-reader-detected');
  // **要素そのものは常にある**（live region は中身が変わる前から DOM に無いと鳴らない）。
  await expect(notice).toHaveCount(1);
  await expect(notice).toHaveText('');

  const checkbox = settings.getByRole('checkbox', { name: CHECKBOX_LABEL, exact: true });
  await expect(checkbox).not.toBeChecked();

  await closeSettings(app);

  // --- 2. 支援技術を検知した状態にして開き直す ---
  await app.evaluate(({ app: electronApp }) => {
    electronApp.accessibilitySupportEnabled = true;
  });

  const detected = await openSettingsWindow(launched, () =>
    window.locator('button[aria-label="設定を開く"]').click(),
  );
  await detected.waitForLoadState('domcontentloaded');

  const detectedNotice = detected.locator('#settings-screen-reader-detected');
  await expect(detectedNotice).toHaveText(NOTICE);

  // **チェックボックスの意味は変えない。** 勝手に checked にすると
  // 「設定値」と「実効値」の区別が画面から消える。
  const detectedCheckbox = detected.getByRole('checkbox', { name: CHECKBOX_LABEL, exact: true });
  await expect(detectedCheckbox).not.toBeChecked();

  // ⭐ **アクセシブル名がこの文で汚れていないこと。**
  // `getByRole(..., { exact: true })` が引けている時点で名前は可視ラベルと一致している
  // （`<label>` の中にこの行を入れた実装なら、名前が連結されてここで引けなくなる）。
  // 念のため、名前に注記の語が混ざっていないことも直接見る。
  const accessibleName = await detectedCheckbox.evaluate((el) => {
    const label = el.closest('label');
    return label ? (label.textContent ?? '') : '';
  });
  expect(accessibleName).not.toContain('いま有効');

  // **説明として AT に届く経路があること**（これが無いと、対象者は「オフ」としか聞けない）。
  await expect(detectedCheckbox).toHaveAttribute(
    'aria-describedby',
    'settings-screen-reader-detected',
  );

  // --- 3. 自分でチェックを入れたら消える（食い違っていないので説明する情報が無い） ---
  // ⚠ `check()` を使わない。**チェック状態は `config.set` の往復で決まる**
  // （制御コンポーネント）ので、クリック直後に同期で確かめる `check()` は
  // 「押したのに状態が変わらない」と判定して落ちる。押してから待つ。
  await detectedCheckbox.click();
  await expect(detectedCheckbox).toBeChecked();
  await expect(detectedNotice).toHaveText('');
});
