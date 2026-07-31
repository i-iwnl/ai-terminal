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
 * Issue #20 PR 11。従来の通知バナーは `useState<string | null>` の単一文字列で、
 * (1) 後から来た通知が前の通知を黙って消す、(2) severity の区別が無く
 * 「タブを閉じました」も「PTY の起動に失敗しました」も同じ見た目、という2つの問題があった。
 *
 * 通知バナーを実際のユーザー操作から再現できる経路は、この harness では
 * PTY の終了しかない（S11 のコメントどおり、node-pty の spawn 失敗はこの環境では
 * 非同期にしか失敗せず、useTabs.ts の showError 経路を同期的には再現できない）。
 * そこで正常終了（コード0）と異常終了（0以外のコード）を実際に起こし分けて、
 * severityForExit（lib/notices.ts）が振り分ける情報/エラーの両方を実データで検証する。
 */
test('S55 通知が複数同時に出ても、それぞれ独立に閉じられ、severityが色以外の手がかりでも区別できる', async () => {
  const { window, workDir } = launched;
  const cwdName = workDir.split('/').pop() as string;
  const promptPattern = new RegExp(`${cwdName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[%#]`);

  // **最初のシェルタブが出るまで待つ。** グローバルショートカットの keydown リスナは
  // App.tsx の useEffect で張られるので、マウント前に押した Meta+t は取りこぼされる
  // （待たずに押すとタブが増えず、`toHaveCount(2)` が 1 のまま 15 秒待って落ちる）。
  // S06 など既存の spec も同じ理由で最初に toHaveCount(1) を待っている。
  await expect(window.locator('.tab-bar__tab')).toHaveCount(1, { timeout: 15_000 });

  // 1枚目のタブを正常終了（コード0）させる -> 情報 severity の通知が出る。
  await window.keyboard.press('Meta+t');
  await expect(window.locator('.tab-bar__tab')).toHaveCount(2, { timeout: 15_000 });
  const shellA = window.locator('.terminal-pane:not(.terminal-pane--hidden) .xterm-screen').first();
  await expect(shellA).toContainText(promptPattern, { timeout: 20_000 });
  await window.locator('.terminal-pane:not(.terminal-pane--hidden) .xterm-helper-textarea').focus();
  await window.keyboard.type('exit');
  await window.keyboard.press('Enter');

  const infoBanner = window.locator('.notice-banner--info');
  await expect(infoBanner).toHaveCount(1, { timeout: 15_000 });

  // 2枚目のタブを異常終了（コード7）させる -> エラー severity の通知が「追加」される
  // （配列化前は、これが1枚目の情報通知を黙って上書きして消していた）。
  await window.keyboard.press('Meta+t');
  await expect(window.locator('.tab-bar__tab')).toHaveCount(3, { timeout: 15_000 });
  const shellB = window.locator('.terminal-pane:not(.terminal-pane--hidden) .xterm-screen').first();
  await expect(shellB).toContainText(promptPattern, { timeout: 20_000 });
  await window.locator('.terminal-pane:not(.terminal-pane--hidden) .xterm-helper-textarea').focus();
  await window.keyboard.type('exit 7');
  await window.keyboard.press('Enter');

  const errorBanner = window.locator('.notice-banner--error');
  await expect(errorBanner).toHaveCount(1, { timeout: 15_000 });

  // --- 配列化: 情報通知がエラー通知に上書きされず、両方が同時に残っていること ---
  await expect(infoBanner).toHaveCount(1);
  await expect(window.locator('.notice-banner')).toHaveCount(2);

  // --- 右上へ移したこと ---
  // タブバー（36px）より下、かつウィンドウの水平中央より右に位置する。
  // **`viewportSize()` は Electron では null を返す**（Playwright がビューポートを
  // 設定していないため）。実ウィンドウの寸法は Renderer 側で聞く
  // （`e2e/screenshots.spec.ts` も同じ理由で `window.innerWidth` を使っている）。
  const viewportWidth = await window.evaluate(() => window.innerWidth);
  expect(viewportWidth).toBeGreaterThan(0);
  const box = await window.locator('.notice-list').boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    expect(box.y).toBeGreaterThanOrEqual(36);
    expect(box.x + box.width / 2).toBeGreaterThan(viewportWidth / 2);
  }

  // --- severity は色だけで表さない: アイコンの字形と語の両方が、色を見なくても
  //     独立に判別できること ---
  await expect(infoBanner.locator('.notice-banner__icon')).toHaveText('i');
  await expect(infoBanner.locator('.notice-banner__label')).toHaveText('情報');
  await expect(errorBanner.locator('.notice-banner__icon')).toHaveText('!');
  await expect(errorBanner.locator('.notice-banner__label')).toHaveText('エラー');

  // --- role="alert": エラーが1件でもある間は、通知の入れ物ちょうど1個だけが
  //     assertive な live region として露出していること（2個以上が同時に喋って
  //     互いを潰し合わないこと）。合わせて、xterm 側の別系統（S37）・
  //     PTY 終了の a11y 専用告知（S48 の .app-status）がそれぞれ影響を受けず
  //     ちょうど1個のままであることも確認する。 ---
  await expect(window.getByRole('alert')).toHaveCount(1);
  await expect(window.locator('.xterm-accessibility')).toHaveCount(0);
  await expect(window.getByRole('status')).toHaveCount(1);
  await expect(window.locator('.app-status')).toHaveCount(1);

  // --- 個別に閉じられること: エラー側だけ閉じても情報側は残る ---
  await errorBanner.locator('button[aria-label="閉じる"]').click();
  await expect(errorBanner).toHaveCount(0);
  await expect(infoBanner).toHaveCount(1);

  // エラーが無くなったので、入れ物は polite（role="status"）に落ちる。
  // ページ全体では .app-status と合わせて role="status" が2個になりうるが、
  // どちらも polite で互いを中断しないため、assertive の不変条件（常に1個）は壊れない。
  await expect(window.getByRole('alert')).toHaveCount(0);

  // 残った情報通知も閉じられ、通知の入れ物ごと消えること。
  await infoBanner.locator('button[aria-label="閉じる"]').click();
  await expect(window.locator('.notice-banner')).toHaveCount(0);
  await expect(window.locator('.notice-list')).toHaveCount(0);

  // 通知が無くなっても、アプリ本体・.app-status は健在であること。
  await expect(window.locator('.app')).toBeVisible();
  await expect(window.locator('.app-status')).toHaveCount(1);
});
