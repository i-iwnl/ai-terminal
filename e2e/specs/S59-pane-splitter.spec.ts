import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';
import { IpcSend } from '../../src/shared/ipc';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

/** 正規表現の特殊文字をエスケープする（S07/S08 等と同じ理由） */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Main プロセス内で `pty:resize`（IpcSend.ptyResize）の発火回数を数える
 * カウンタを仕込む。PR 5 の周で実証済みの手法（`electronApp.evaluate()` に
 * `ipcMain.on` を足して回数を数える）をそのまま使う。
 *
 * `evaluate` に渡す関数は Main プロセス側でシリアライズして実行されるため、
 * このファイルの外側のスコープ（import した変数・関数）を一切参照できない。
 * チャンネル名だけを引数として渡し、関数の中は `ipcMain` と組み込み API だけで
 * 完結させる。
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

async function clickMenuItem(app: LaunchedApp['app'], label: string): Promise<boolean> {
  return app.evaluate(({ Menu }, targetLabel) => {
    const menu = Menu.getApplicationMenu();
    if (!menu) return false;
    let target: Electron.MenuItem | undefined;
    const walk = (items: Electron.MenuItem[]): void => {
      for (const item of items) {
        if (item.label === targetLabel) target = item;
        if (item.submenu) walk(item.submenu.items);
      }
    };
    walk(menu.items);
    if (!target?.click) return false;
    target.click();
    return true;
  }, label);
}

/**
 * Issue #56 PR 7: スプリッタ（design-review.md「提案 D'（改訂）: スプリッタ」）。
 *
 * design-review.md が定める関門・仕様を実測で固定する。
 *
 * 1. **関門**: ドラッグ中は `pty:resize` が飛ばず、`mouseup` 後に飛ぶこと
 *    （ゴースト方式。Grid = `.pane-split__cell` の flex-grow はドラッグ中
 *    一切書き換えない）。
 * 2. **aria**: `role="separator"` + `aria-label` + `aria-valuenow/min/max` +
 *    `aria-valuetext`。**`aria-orientation` は分割線自身の向き**（左右分割
 *    （row）は縦線なので `vertical`。`dir` をそのまま渡すと逆になる）。
 * 3. **`tabIndex={-1}`**: Tab のシーケンシャルナビゲーションでは到達しない
 *    こと（Tab は xterm が端末入力として食う。ARIA で「Tab で到達できる」と
 *    嘘をつかない）が、メニュー項目から `.focus()` すると実際にフォーカスが
 *    乗ること（`tabindex` を完全に外すと `.focus()` 自体が no-op になるため、
 *    design-review.md の「tabindex を付けない」と「メニューからプログラム的に
 *    focus() する」を両立させるレビューでの訂正。`-1` はシーケンシャル
 *    ナビゲーションの対象外という仕様上の保証がある）。
 * 4. **クリックのデッドゾーン**: 移動量が閾値未満の mouseup は、ratio を
 *    変えずに「押した側のペインをアクティブにする」だけになること。
 * 5. **メニュー項目**: 「分割比を広げる/狭める/50%に戻す」がメニューにあり、
 *    実際に ratio を動かせること（WCAG 2.5.7/2.5.8 の Equivalent 例外の根拠）。
 *    比率を動かした対象のスプリッタへ `.focus()` すること（ペインが3枚以上で
 *    スプリッタが複数本あるとき、どれが動いたかを示す唯一の手がかり）。
 */
test('S59 スプリッタはドラッグ中resizeを飛ばさずmouseupで確定し、閾値未満クリックはアクティブ化に倒れ、メニュー項目でも調整できる', async () => {
  const { window, workDir } = launched;
  const cwdName = workDir.split('/').pop() as string;
  const promptPattern = new RegExp(`${escapeRegExp(cwdName)}\\s*[%#]`);

  const splitter = window.locator('.pane-splitter');
  // 分割の子は必ず2つで DOM 順もそのまま（PaneTreeView.tsx が
  // children[0] -> スプリッタ -> children[1] の順で描画する）。
  // 左右分割（row）なら1番目が左、2番目が右のペイン。
  const leftPane = window.locator('.pane-split__cell').first().locator('.terminal-pane');
  const rightPane = window.locator('.pane-split__cell').last().locator('.terminal-pane');
  const rowsOf = (scope: string): ReturnType<typeof window.locator> =>
    window.locator(`${scope} .xterm-rows > div`);

  // --- 起動直後: 1ペインなのでスプリッタは無い ------------------------------
  await expect(window.locator('.terminal-pane')).toHaveCount(1);
  await expect(splitter).toHaveCount(0);
  await expect(window.locator('.terminal-pane.is-active .xterm-screen')).toContainText(promptPattern, {
    timeout: 20_000,
  });

  // --- Cmd+D: 右に分割（左右分割 = dir: 'row'） ------------------------------
  await window.keyboard.press('Meta+d');
  await expect(window.locator('.terminal-pane')).toHaveCount(2);
  await expect(splitter).toHaveCount(1);
  await expect(rowsOf('.terminal-pane.is-active')).not.toHaveCount(0, { timeout: 10_000 });
  await expect(rowsOf('.terminal-pane:not(.is-active)')).not.toHaveCount(0, { timeout: 10_000 });
  // 分割直後は新しく作った右側のペインがアクティブ（useTabs.ts の splitActivePane）。
  await expect(rightPane).toHaveClass(/is-active/);
  await expect(leftPane).not.toHaveClass(/is-active/);

  // --- aria: role/label/valuenow/min/max/valuetext/orientation ---------------
  await expect(splitter).toHaveAttribute('role', 'separator');
  // 左右分割（row）のスプリッタは縦線なので vertical（dir をそのまま渡すと逆になる）。
  await expect(splitter).toHaveAttribute('aria-orientation', 'vertical');
  await expect(splitter).toHaveAttribute('aria-label', '左右の分割比');
  await expect(splitter).toHaveAttribute('aria-valuemin', '0');
  await expect(splitter).toHaveAttribute('aria-valuemax', '100');
  await expect(splitter).toHaveAttribute('aria-valuenow', '50');
  await expect(splitter).toHaveAttribute('aria-valuetext', '左 50% 右 50%');
  // tabIndex={-1}: シーケンシャルナビゲーション（Tab）の対象外だが、
  // プログラム的な .focus() は受け付ける（PaneSplitterHandle.tsx 冒頭コメント）。
  await expect(splitter).toHaveAttribute('tabindex', '-1');

  // --- Tab では到達しないこと（tabindex="-1" の証明） -----------------------
  // 画面には他にも Tab で止まる要素（タブバーの設定ボタン・サイドバー・xterm の
  // 隠し textarea 等）があるため、実際に Tab を何度か押して回り、その間
  // document.activeElement が一度もスプリッタにならないことを見る
  // （tabindex="-1" と宣言してあるだけでなく、実際に Tab で拾われないことまで
  // 固定しないと「ARIA で嘘をついていない」ことが担保されない）。
  const isSplitterFocused = (): Promise<boolean> =>
    window.evaluate(() => document.activeElement?.classList.contains('pane-splitter') ?? false);

  await window.locator('.tab-bar__settings').focus();
  for (let i = 1; i <= 15; i += 1) {
    await window.keyboard.press('Tab');
    expect(await isSplitterFocused(), `Tab ${i}回目でスプリッタにフォーカスが到達した`).toBe(false);
  }

  // --- 関門: ドラッグ中は pty:resize が飛ばず、mouseup 後に飛ぶこと ----------
  await installResizeCounter(launched.app, IpcSend.ptyResize);

  const box = await splitter.boundingBox();
  expect(box, 'スプリッタの bounding box が取得できない').not.toBeNull();
  const startX = box!.x + box!.width / 2;
  const centerY = box!.y + box!.height / 2;

  await window.mouse.move(startX, centerY);
  await window.mouse.down();

  const DRAG_DELTA_PX = 80;
  const DRAG_STEPS = 8;
  for (let i = 1; i <= DRAG_STEPS; i += 1) {
    await window.mouse.move(startX + (DRAG_DELTA_PX * i) / DRAG_STEPS, centerY);
    // 1ステップごとに確認する。ゴースト方式なら、この時点でまだ1回も飛んでいない。
    expect(
      await readResizeCount(launched.app),
      `ドラッグ中（${i}/${DRAG_STEPS}歩目）に pty:resize が飛んでいる`,
    ).toBe(0);
  }

  const duringDragCount = await readResizeCount(launched.app);

  await window.mouse.up();

  // mouseup 後、確定した ratio の反映で resize が飛ぶまで待つ（非同期）。
  await expect.poll(async () => readResizeCount(launched.app), { timeout: 10_000 }).toBeGreaterThan(0);

  // 飛び終えたあと、さらに増え続けない（ドラッグ自体はもう終わっているため）ことを見る。
  const settledCount = await readResizeCount(launched.app);
  await window.waitForTimeout(500);
  const afterSettleCount = await readResizeCount(launched.app);

  console.log(
    `[S59] pty:resize 実測: ドラッグ中=${duringDragCount}, mouseup直後=${settledCount}, 500ms後=${afterSettleCount}`,
  );

  expect(duringDragCount, 'ドラッグ中に pty:resize が飛んでいる').toBe(0);
  expect(afterSettleCount, 'mouseup 後に resize が飛び続けている（1回で確定していない）').toBe(settledCount);

  // ratio が実際に動いたこと（50% のままではない）も確認する。
  const ratioAfterDrag = await splitter.getAttribute('aria-valuenow');
  expect(Number(ratioAfterDrag)).not.toBe(50);

  // --- クリックのデッドゾーン: 移動量が閾値未満の mouseup はアクティブ化に倒れる ---
  // ドラッグ後のスプリッタ位置を測り直す（ratio が動いたため座標も変わっている）。
  const boxAfterDrag = await splitter.boundingBox();
  expect(boxAfterDrag).not.toBeNull();
  const clickX = boxAfterDrag!.x + boxAfterDrag!.width / 2;
  const clickY = boxAfterDrag!.y + boxAfterDrag!.height / 2;

  const ratioBeforeClick = await splitter.getAttribute('aria-valuenow');
  await window.mouse.move(clickX, clickY);
  await window.mouse.down();
  // 中心よりわずかに「前」（左側）へ動かす。移動量は4pxの閾値未満なのでドラッグには
  // ならないが、`splitterClickSide` はポインタが中心から見て負側にあれば
  // 最初の子（左側）を選ぶ（paneSplitter.ts）。現在アクティブなのは右側なので、
  // これで「押した側のペインがアクティブになる」（左側への切り替え）を検証できる。
  await window.mouse.move(clickX - 1, clickY);
  await window.mouse.up();

  // ratio は変わっていない（ドラッグとして確定していない）。
  await expect(splitter).toHaveAttribute('aria-valuenow', ratioBeforeClick ?? '');
  // 左側ペインがアクティブに切り替わる（右側から）。
  await expect(leftPane).toHaveClass(/is-active/, { timeout: 5_000 });
  await expect(rightPane).not.toHaveClass(/is-active/);

  // --- メニュー項目: 分割比を広げる/狭める/50%に戻す -------------------------
  const menuLabels = await launched.app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu();
    if (!menu) return [];
    const out: string[] = [];
    const walk = (items: Electron.MenuItem[]): void => {
      for (const item of items) {
        out.push(item.label);
        if (item.submenu) walk(item.submenu.items);
      }
    };
    walk(menu.items);
    return out;
  });
  expect(menuLabels).toContain('分割比を広げる');
  expect(menuLabels).toContain('分割比を狭める');
  expect(menuLabels).toContain('分割比を50%に戻す');

  // メニュー由来の .focus() を検証する前に、フォーカスを明示的にスプリッタの
  // 外へ移しておく。**`tabIndex={-1}` はクリックでのフォーカスは妨げない**
  // （Tab のシーケンシャルナビゲーションから外れるだけで、マウスクリックや
  // `.focus()` では通常どおりフォーカス可能）ため、直前のドラッグ/クリック
  // 検証の操作でスプリッタ自身に既にフォーカスが乗っている。ここで一度
  // 逃がしてから検証しないと「メニューが .focus() した」ことを区別できない。
  await window.locator('.tab-bar__settings').focus();
  expect(await isSplitterFocused(), 'フォーカスを逃がしたはずなのにスプリッタへ乗っている').toBe(false);

  // 「50%に戻す」で valuenow が 50 に戻ること。
  expect(await clickMenuItem(launched.app, '分割比を50%に戻す')).toBe(true);
  await expect(splitter).toHaveAttribute('aria-valuenow', '50');
  await expect(splitter).toHaveAttribute('aria-valuetext', '左 50% 右 50%');
  // **メニュー項目から .focus() が実際に効くこと**（対象のスプリッタへ）。
  // tabIndex={-1} なので Tab では到達しないが、App.tsx がこの操作の対象に
  // なった経路（parentPath）のスプリッタを splitterRefs から引いて .focus()
  // する（PaneSplitterHandle.tsx / App.tsx 冒頭コメント）。
  await expect
    .poll(isSplitterFocused, 'メニュー項目クリック後にスプリッタへフォーカスが乗っていない')
    .toBe(true);

  // アクティブなペインは直前のクリックで左側（最初の子。childIndex 0）になっている。
  // 最初の子の取り分はそのまま ratio 自身なので、「広げる」は valuenow を増やす方向。
  expect(await clickMenuItem(launched.app, '分割比を広げる')).toBe(true);
  await expect(splitter).toHaveAttribute('aria-valuenow', '55');
  expect(await isSplitterFocused(), '広げる操作後も引き続きスプリッタにフォーカスが乗っているはず').toBe(
    true,
  );

  // 「狭める」で元の 50 に戻ること。
  expect(await clickMenuItem(launched.app, '分割比を狭める')).toBe(true);
  await expect(splitter).toHaveAttribute('aria-valuenow', '50');
  expect(await isSplitterFocused()).toBe(true);

  // --- 分割されていないタブでの調整: 通知が出るだけで落ちないこと -------------
  await window.keyboard.press('Meta+w'); // アクティブ（左側）ペインを閉じ、1ペインに戻す
  await expect(window.locator('.terminal-pane')).toHaveCount(1);
  await expect(splitter).toHaveCount(0);
  expect(await clickMenuItem(launched.app, '分割比を広げる')).toBe(true);
  await expect(window.locator('.notice-banner')).toContainText('分割されていません');
});
