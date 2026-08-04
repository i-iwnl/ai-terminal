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
 * `shell.openExternal` を差し替えて、**本物のブラウザを起動せずに**
 * 「何を開こうとしたか」だけを記録する。
 *
 * **production コードに1行もテスト用のフックを入れていない**（S91 の
 * `Menu.prototype.popup` 差し替えと同じ枠組み）。`external-links.ts` は
 * `import { shell } from 'electron'` の**同じオブジェクトのプロパティ**を
 * 呼び出し時に引くので、ここで差し替えた関数がそのまま効く。
 */
async function installOpenExternalSpy(app: LaunchedApp['app']): Promise<void> {
  await app.evaluate(({ shell }) => {
    const g = globalThis as unknown as { __openedExternally?: string[] };
    g.__openedExternally = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (shell as any).openExternal = (url: string): Promise<void> => {
      (g.__openedExternally as string[]).push(url);
      return Promise.resolve();
    };
  });
}

/** これまでに既定ブラウザへ渡そうとした URL。 */
async function openedExternally(app: LaunchedApp['app']): Promise<string[]> {
  return app.evaluate(() => {
    const g = globalThis as unknown as { __openedExternally?: string[] };
    return g.__openedExternally ?? [];
  });
}

/** 生きている BrowserWindow の数（アプリ内に窓が生まれていないかを見る）。 */
async function windowCount(app: LaunchedApp['app']): Promise<number> {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
}

/**
 * Issue #178 周1（統合元 #174）。**ターミナルに出た URL を既定ブラウザへ逃がす。**
 *
 * それまで `setWindowOpenHandler` はアプリ全体に0件で、`window.open()` に対して
 * Electron が**アドレスバーも戻るボタンも無い `BrowserWindow`** を自前で作っていた。
 * しかもその窓には Renderer 側の `Cmd+W`（`close-pane`）が届かないので、
 * 剥がすには信号機をマウスで押すしかない。エージェントは PR リンク・localhost・docs を
 * 1日中吐くため、誤爆1回あたり 8〜9手 × 3〜10回/日 の損失になっていた。
 *
 * この spec が見るのは**逃がしの配線**:
 * `window.open()` -> アプリ内に窓が増えない（`{ action: 'deny' }`）
 * -> `shell.openExternal` に URL が渡る。
 *
 * **どのスキームを弾くかの網羅は `test/unit/external-links.test.ts` が正。**
 * 開いた先（本物のブラウザ）は Playwright から観測できないので、判定は
 * 純粋関数 `isSafeExternalUrl` に切り出してそちらで固定してある。
 * ここでは**その門が実際に配線に載っていること**を `file:` 1件で見る。
 */
test('S92 ターミナルのリンクは既定ブラウザへ渡り、アプリ内に窓が生まれない', async () => {
  const { app, window } = launched;

  const screen = window.locator('.terminal-pane__container .xterm-screen').first();
  await expect(screen).toContainText(/[$%#>]/, { timeout: 20_000 });

  await installOpenExternalSpy(app);
  // スパイを張った直後は空であること（下の assert が「前から入っていた値」を
  // 見ていないことの担保）。
  expect(await openedExternally(app)).toEqual([]);

  // 起動直後は本体ウィンドウ1枚。ここが増えるかどうかがこの spec の主眼。
  const before = await windowCount(app);
  expect(before).toBe(1);

  // --- リンクを開こうとする ---------------------------------------------------
  //
  // `WebLinksAddon` のハンドラが呼ぶのと**同じ `window.open()`** を直接叩く。
  // xterm のリンク判定そのものは周2（S93）の担当で、ここでは逃がし先だけを見る。
  await window.evaluate(() => {
    window.open('https://example.com/S92-external', '_blank', 'noopener,noreferrer');
  });

  await expect
    .poll(async () => openedExternally(app), {
      message: '既定ブラウザへ URL が渡っていない（setWindowOpenHandler が deny だけして捨てている）',
      timeout: 10_000,
    })
    .toEqual(['https://example.com/S92-external']);

  // **アプリ内に窓が増えていないこと。** ハンドラが無いと、ここで
  // アドレスバーの無い `BrowserWindow` が1枚増える。
  expect(
    await windowCount(app),
    'アプリ内に新しい BrowserWindow が生まれている（{ action: "deny" } が効いていない）',
  ).toBe(before);

  // --- allowlist の門が配線に載っていること -----------------------------------
  //
  // `file:` は Finder を起動できるので `openExternal` に渡してはいけない。
  // **それでも窓は作らない**（deny は allowlist の判定と独立している）。
  await window.evaluate(() => {
    window.open('file:///etc/passwd', '_blank', 'noopener,noreferrer');
  });

  // 非同期の取りこぼしで green にならないよう、後続の許可 URL が
  // 「1件あとに」入ることで file: が挟まっていないことを確定させる。
  await window.evaluate(() => {
    window.open('https://example.com/S92-after', '_blank', 'noopener,noreferrer');
  });

  await expect
    .poll(async () => openedExternally(app), { timeout: 10_000 })
    .toEqual(['https://example.com/S92-external', 'https://example.com/S92-after']);

  expect(await windowCount(app), 'file: でもアプリ内に窓を作ってはいけない').toBe(before);

  // --- 設定ウィンドウにも同じ逃がし先が付いていること --------------------------
  //
  // **ウィンドウ生成点は2つある**（`index.ts` の `createWindow` と
  // `settings-window.ts` の `openSettingsWindow`）。片方だけ見ていると、
  // 付け忘れたほうが「アドレスバーの無い窓が開く」挙動のまま残る。
  // `external-links.ts` に集約した理由がこれなので、**両方から観測する**。
  const settings = await openSettingsWindow(launched, () =>
    window.locator('button[aria-label="設定を開く"]').click(),
  );
  const withSettings = await windowCount(app);
  expect(withSettings).toBe(before + 1);

  await settings.evaluate(() => {
    window.open('https://example.com/S92-from-settings', '_blank', 'noopener,noreferrer');
  });

  await expect
    .poll(async () => openedExternally(app), {
      message: '設定ウィンドウ側に setWindowOpenHandler が付いていない',
      timeout: 10_000,
    })
    .toEqual([
      'https://example.com/S92-external',
      'https://example.com/S92-after',
      'https://example.com/S92-from-settings',
    ]);

  expect(await windowCount(app), '設定ウィンドウからも窓を作ってはいけない').toBe(withSettings);
});
