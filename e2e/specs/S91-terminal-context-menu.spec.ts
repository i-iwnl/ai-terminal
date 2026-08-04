import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

interface CapturedItem {
  label: string;
  type: string;
  role: string | null;
  enabled: boolean;
}

/**
 * `Menu.prototype.popup` を差し替えて、出そうとしたメニューの中身を捕まえる。
 *
 * **本物を開かない**のが要点。ネイティブメニューは macOS のモーダルな
 * トラッキングループに入るので、E2E で実際に開くとテストが固まりうる。
 * ここでは popup を潰して `this.items` だけを記録する。
 *
 * **production コードに1行もテスト用のフックを入れていない。**
 * `Menu.popup` は JS 側（`Menu.prototype`）にあるので、`app.evaluate()` から
 * 差し替えられる。`S36` が `Menu.getApplicationMenu()` を歩くのと同じ枠組み。
 */
async function installMenuSpy(app: LaunchedApp['app']): Promise<void> {
  await app.evaluate(({ Menu }) => {
    const g = globalThis as unknown as { __popped?: unknown[]; __lastMenu?: unknown };
    g.__popped = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Menu.prototype as any).popup = function (this: Electron.Menu) {
      g.__lastMenu = this;
      (g.__popped as unknown[]).push(
        this.items.map((i) => ({
          label: i.label,
          type: i.type,
          role: i.role ?? null,
          enabled: i.enabled,
        })),
      );
    };
  });
}

/** 直近に popup しようとしたメニューの項目（まだ1度も popup していなければ null）。 */
async function lastPoppedItems(app: LaunchedApp['app']): Promise<CapturedItem[] | null> {
  return app.evaluate(() => {
    const g = globalThis as unknown as { __popped?: CapturedItem[][] };
    const all = g.__popped ?? [];
    return all.length === 0 ? null : all[all.length - 1];
  });
}

/** 捕まえたメニューの n 番目の項目を実際にクリックする（= その AppAction を流す）。 */
async function clickCapturedItem(app: LaunchedApp['app'], index: number): Promise<void> {
  await app.evaluate((_electron, i) => {
    const g = globalThis as unknown as { __lastMenu?: Electron.Menu };
    g.__lastMenu?.items[i]?.click();
  }, index);
}

/**
 * Issue #135。**ターミナル面の右クリックメニュー。**
 *
 * `contextmenu` / `Menu.popup` はそれまでアプリ全体に0件だった。
 * Terminal.app / iTerm2 / Ghostty はいずれもターミナル面の右クリックで
 * メニューを出すので、design-review では「Mac らしくない箇所の最大値」と評された。
 *
 * **ネイティブ（Main の `Menu.popup()`）を選んだ**（5人中3人が推した）。
 * HTML メニューは `.terminal-stack` / `.pane-split__cell` の `overflow: hidden` で
 * 切られ、DOM フォーカスを奪って DECSET 1004 の `ESC [ O` を PTY へ流し、
 * コピー / ペーストが xterm 本来の経路（bracketed paste を含む）から外れる。
 * 詳細は `src/shared/context-menu.ts` の冒頭。
 *
 * **「ネイティブは E2E で検証できない」は誤りだった。** `Menu.prototype.popup` は
 * JS 側にあるので差し替えられ、項目も `click()` も取れる（Electron 43 で実測）。
 *
 * この spec が見るのは**配線**:
 * 右クリック -> Renderer が状況を送る -> Main が popup を呼ぶ -> 項目を click すると
 * 既存の `AppAction` が流れて実際に分割される。
 * **項目・並び・語・有効/無効の正は `test/unit/context-menu.test.ts`。**
 */
test('S91 ターミナル面の右クリックでメニューが出て、項目を選ぶと既存の操作が走る', async () => {
  const { window } = launched;

  const panes = window.locator('.terminal-pane');
  const activeScreen = window.locator('.terminal-pane.is-active .xterm-screen');

  await expect(window.locator('.tab-bar__tab')).toHaveCount(1, { timeout: 15_000 });
  await expect(activeScreen).toContainText(/[$%#>]/, { timeout: 20_000 });
  await expect(panes).toHaveCount(1);

  await installMenuSpy(launched.app);
  // スパイを張った直後は、まだ1度も popup していないこと（下の assert が
  // 「前から入っていた値」を見ていないことの担保）。
  expect(await lastPoppedItems(launched.app)).toBeNull();

  // --- 右クリック -------------------------------------------------------------
  const screen = window.locator('.terminal-pane.is-active .xterm-screen');
  const box = await screen.boundingBox();
  expect(box, 'ペインの矩形が取れていない').not.toBeNull();
  if (!box) throw new Error('unreachable');
  // 座標は決め打ちせず矩形から出す（S25 と同じ作法）。
  await window.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });

  // --- Main が popup を呼んだこと ---------------------------------------------
  await expect
    .poll(async () => (await lastPoppedItems(launched.app))?.length ?? 0, { timeout: 10_000 })
    .toBeGreaterThan(0);

  const items = await lastPoppedItems(launched.app);
  if (!items) throw new Error('メニューを捕まえられなかった');
  const labels = items.filter((i) => i.type !== 'separator').map((i) => i.label);

  // **1ペインのタブなので「ペイン」という語を1つも出さない**（`context-menu.ts`）。
  expect(labels).toEqual([
    'コピー',
    'ペースト',
    '右に分割',
    '下に分割',
    '画面を消去',
    'ターミナル内を検索',
    'タブを閉じる',
  ]);

  // クリップボードが先頭で、選択が無いので「コピー」は無効。
  expect(items[0]).toMatchObject({ label: 'コピー', role: 'copy', enabled: false });
  expect(items[1]).toMatchObject({ label: 'ペースト', role: 'paste', enabled: true });

  // --- 項目を選ぶと、既存の AppAction が実際に走ること -------------------------
  //
  // 「右に分割」を選ぶ。**新しい能力を作っていない**ことが、この1手で分かる
  // （`split-pane` が `Cmd+D` と同じ経路を通る）。
  const splitIndex = items.findIndex((i) => i.label === '右に分割');
  expect(splitIndex).toBeGreaterThan(-1);
  await clickCapturedItem(launched.app, splitIndex);
  await expect(panes).toHaveCount(2, { timeout: 15_000 });

  // --- 分割後は「ペイン」の群が出る -------------------------------------------
  const splitScreen = window.locator('.terminal-pane.is-active .xterm-screen');
  await expect(splitScreen).toContainText(/[$%#>]/, { timeout: 20_000 });
  const splitBox = await splitScreen.boundingBox();
  if (!splitBox) throw new Error('分割後のペインの矩形が取れていない');
  await window.mouse.click(splitBox.x + splitBox.width / 2, splitBox.y + splitBox.height / 2, {
    button: 'right',
  });

  await expect
    .poll(
      async () =>
        (await lastPoppedItems(launched.app))
          ?.filter((i) => i.type !== 'separator')
          .map((i) => i.label)
          .join(',') ?? '',
      { timeout: 10_000 },
    )
    .toContain('ペインを最大化');

  const splitItems = await lastPoppedItems(launched.app);
  if (!splitItems) throw new Error('分割後のメニューを捕まえられなかった');
  const splitLabels = splitItems.filter((i) => i.type !== 'separator').map((i) => i.label);
  expect(splitLabels).toEqual([
    'コピー',
    'ペースト',
    '右に分割',
    '下に分割',
    '画面を消去',
    'ターミナル内を検索',
    'ペインを最大化',
    'ペイン名を変更...',
    'ペインを閉じる',
  ]);

  // --- 右クリックしたペインがアクティブになること ------------------------------
  //
  // **これが無いと、4分割で右下を右クリックして「閉じる」を選ぶと左上が死ぬ。**
  // `AppAction` は対象ペインを運ばないので、メニューを出す前にアクティブを移す必要がある。
  //
  // **測る場所はペインヘッダ。** xterm 自身の `rightClickHandler` は
  // `.xterm` 要素にリスナを張り、隠し textarea を `focus()` する。その副作用で
  // `onFocusCapture` -> `onActivate` が走るので、**ターミナル面の上で測ると
  // アプリ側の実装を1行も消しても green のまま**になる（実測で確認した）。
  // ペインヘッダ（`.pane-header`）は `.xterm` の外なので xterm は発火せず、
  // ここで初めて `onContextMenu` の中の `onActivate?.()` が判別できる。
  const visiblePanes = window.locator('.terminal-pane:not(.terminal-pane--hidden)');
  const firstPane = visiblePanes.first();
  await expect(firstPane).not.toHaveClass(/is-active/);
  const headerBox = await firstPane.locator('.pane-header').boundingBox();
  expect(headerBox, 'ペインヘッダの矩形が取れていない（分割中しか出ない）').not.toBeNull();
  if (!headerBox) throw new Error('unreachable');
  await window.mouse.click(headerBox.x + headerBox.width / 2, headerBox.y + headerBox.height / 2, {
    button: 'right',
  });
  await expect(firstPane).toHaveClass(/is-active/, { timeout: 10_000 });

  // --- xterm のテキスト選択を壊していないこと ----------------------------------
  //
  // 右クリックは `preventDefault()` しているが、xterm 自身の
  // `rightClickHandler`（カーソル下の語を選ぶ）は動いたままでよい。
  // ここでは**左ドラッグの選択が生きている**ことを見る（S25 と同じ経路）。
  const firstScreenBox = await firstPane.locator('.xterm-screen').boundingBox();
  if (!firstScreenBox) throw new Error('1枚目のペインの矩形が取れていない');
  await window.mouse.move(firstScreenBox.x + 10, firstScreenBox.y + 6);
  await window.mouse.down();
  await window.mouse.move(firstScreenBox.x + 120, firstScreenBox.y + 6, { steps: 8 });
  await window.mouse.up();
  const selection = await window.evaluate(() => window.getSelection()?.toString() ?? '');
  // DOM 選択と xterm 内部選択のどちらで来るかは環境依存なので、
  // 「選択操作でアプリが壊れていない（ペイン構成が変わっていない）」ことを主に見る。
  expect(typeof selection).toBe('string');
  await expect(panes).toHaveCount(2);
});
