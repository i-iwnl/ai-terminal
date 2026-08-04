import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

/** S92 と同じ枠組みで `shell.openExternal` を差し替え、本物のブラウザを起動しない。 */
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

async function openedExternally(app: LaunchedApp['app']): Promise<string[]> {
  return app.evaluate(() => {
    const g = globalThis as unknown as { __openedExternally?: string[] };
    return g.__openedExternally ?? [];
  });
}

const LINK = 'https://example.com/S93-cmd-click';

/**
 * Issue #178 周2（統合元 #174）。**リンクは Cmd+クリックでだけ開く。**
 *
 * `@xterm/addon-web-links` は修飾キーを一切見ずにハンドラを呼ぶ
 * （`ILinkProviderOptions` は hover / leave / urlRegex しか持たない）。
 * そのため**カーソルを置くつもりの素の左クリックでもリンクが発火**していた。
 * エージェントは PR リンク・localhost・docs を1日中吐くので、誤爆の回数がそのまま
 * 手数になる。iTerm2 / Ghostty / Terminal.app はいずれも Cmd+クリックを要求する。
 *
 * **修飾キーの組み合わせの網羅は `test/unit/link-activation.test.ts` が正。**
 * ここでは代表2ケース（素のクリック / Cmd+クリック）が**実際の xterm 上の
 * クリックで**そう振る舞うことを見る。
 *
 * ⛔ **Cmd+クリックを先に試す。** 逆順だと、座標がリンクから外れていても
 * 「素のクリックで発火しない」が green になり、**何も検証していない spec** になる。
 * 先に発火させることで、その座標がリンクの上にあることが確定する。
 */
test('S93 ターミナルのリンクは Cmd+クリックでだけ開き、素のクリックでは開かない', async () => {
  const { app, window } = launched;

  const screen = window.locator('.terminal-pane__container .xterm-screen').first();
  await expect(screen).toContainText(/[$%#>]/, { timeout: 20_000 });

  await installOpenExternalSpy(app);
  expect(await openedExternally(app)).toEqual([]);

  // --- リンクを1本だけ画面に出す ----------------------------------------------
  await window.locator('.xterm-helper-textarea').first().focus();
  await window.keyboard.type(`echo ${LINK}`, { delay: 20 });
  await window.keyboard.press('Enter');
  await expect(screen).toContainText(LINK, { timeout: 15_000 });

  // 出力行（コマンドをエコーした行ではなく実行結果の行）の矩形を取る。
  //
  // ⛔ **`locator(...).filter({ hasText }).last()` で掴まない。** 実測すると
  // `echo <URL>` をエコーした行のほうが返り、**URL より左（プロンプトの上）を
  // 指すので cursor が `text` のまま**になる。行の中身が**ちょうど URL だけ**で
  // あることを条件にして選ぶ。
  //
  // ⛔ **1回の evaluate で済ませない。** 上の `toContainText(LINK)` は
  // **`echo <URL>` をエコーした行**で先に通るので、その直後だと
  // **出力行がまだ描画されていない**（実測で「非空の行が1本だけ」だった）。
  const findLinkRow = (): Promise<{ x: number; y: number; height: number } | null> =>
    window.evaluate((link) => {
      // **xterm の DOM レンダラは余白をノーブレークスペース（U+00A0）で埋める。**
      // `.trim()` は U+00A0 を落とさないので、そのまま比べると1行も一致しない。
      // **エスケープで書く**（見た目が空白と区別できない文字をソースに置かない）。
      const normalize = (text: string): string => text.replace(/\u00a0/g, ' ').trim();
      const row = Array.from(document.querySelectorAll('.xterm-rows > div')).find(
        (d) => normalize(d.textContent ?? '') === link,
      );
      if (!row) return null;
      const b = row.getBoundingClientRect();
      return { x: b.x, y: b.y, height: b.height };
    }, LINK);

  await expect
    .poll(async () => (await findLinkRow()) !== null, {
      message: 'URL だけが載っている行が描画されない',
      timeout: 15_000,
    })
    .toBe(true);
  const box = await findLinkRow();
  if (!box) throw new Error('unreachable');

  // 行頭から数文字ぶん内側。行全体は端末幅いっぱいなので、中央だと URL の
  // 右側の余白に落ちる（URL は 40 文字弱しかない）。
  const x = box.x + 20;
  const y = box.y + box.height / 2;

  // **この座標がリンクの上にあること**を先に確かめる。xterm はリンクの上で
  // カーソルを pointer にするので、計算後のスタイルで判定できる。
  // これが無いと、下の「素のクリックで開かない」は座標がずれていても green になる。
  await window.mouse.move(x, y);
  await expect
    .poll(async () => screen.evaluate((el) => getComputedStyle(el).cursor), { timeout: 10_000 })
    .toBe('pointer');

  // --- Cmd+クリック: 開く ------------------------------------------------------
  await window.keyboard.down('Meta');
  await window.mouse.click(x, y);
  await window.keyboard.up('Meta');

  await expect
    .poll(async () => openedExternally(app), {
      message: 'Cmd+クリックでリンクが開かない（門が厳しすぎる）',
      timeout: 10_000,
    })
    .toEqual([LINK]);

  // --- 素のクリック: 開かない --------------------------------------------------
  //
  // 上で1件入っているので、**増えないこと**が判定になる（0件のまま待つ形より
  // 強い。座標が外れていれば上で既に落ちている）。
  await window.mouse.move(x, y);
  await window.mouse.click(x, y);
  // 非同期に届く可能性を潰すため、少し待ってから数える。
  await window.waitForTimeout(1_500);
  expect(
    await openedExternally(app),
    '素のクリックでリンクが開いている（カーソルを置くつもりのクリックでブラウザが前に出る）',
  ).toEqual([LINK]);
});
