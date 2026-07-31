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
 * ネイティブメニューは Renderer からは見えないので、Playwright の
 * electronApp.evaluate()（= Main プロセス内で実行される）から Menu を読む。
 *
 * 見るのは3点。
 *
 * 1. **再読み込みがメニューに無いこと。** Electron の既定メニューには
 *    View > Reload（Cmd+R）があり、押すと Renderer が再読み込みされて
 *    全タブの xterm とスクロールバックが消える（PTY は Main 側で生きているので
 *    表示だけが失われる）。ターミナルアプリでは許容できない事故（Issue #22）。
 * 2. **ショートカットがメニューに載っていること。** macOS でキーを見つける
 *    正規の場所はメニューバーで、ここに無いキーは存在しないのと同じ。
 * 3. **メニューから選ぶと Renderer に届くこと。** menu.ts -> IpcEvent.menuAction
 *    -> preload -> App.tsx の経路。キーボード（matchShortcut）とは別の入口なので、
 *    片方だけ壊れても気づけるようにする。
 *
 * ここで検証**できない**こと:
 *
 * メニューとキーボードの二重発火（Main と Renderer が同じキーを登録してしまい、
 * Cmd+T 一回でタブが2枚開く状態）。Playwright の keyboard.press() は Renderer に
 * 合成キーイベントを送るだけで、ネイティブメニューの accelerator 経路を通らない。
 * MenuItem の registerAccelerator もインスタンスからは読めない（実測で全項目 undefined）。
 * 確認手順は .claude/workspace/issue-22/known-issues.md を参照。
 */
test('S36 アプリケーションメニューが定義され、再読み込みが含まれない', async () => {
  const { window } = launched;

  // メニュー全体を { label, accelerator, role } の平坦な配列にして読む
  const items = await launched.app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu();
    if (!menu) return [];
    const out: Array<{ label: string; accelerator?: string; role?: string }> = [];
    const walk = (menuItems: Electron.MenuItem[]): void => {
      for (const item of menuItems) {
        out.push({ label: item.label, accelerator: item.accelerator, role: item.role });
        if (item.submenu) walk(item.submenu.items);
      }
    };
    walk(menu.items);
    return out;
  });

  expect(items.length).toBeGreaterThan(0);

  // 1. 再読み込み系が1つも無いこと。
  //    E2E は本番と同じビルド済みアプリを起動するので、開発時のみの分岐には入らない。
  const roles = items.map((i) => i.role);
  expect(roles).not.toContain('reload');
  expect(roles).not.toContain('forceReload');
  expect(roles).not.toContain('toggleDevTools');

  // 2. 主要な操作がメニューに載っていて、キーも表示されていること。
  const byLabel = new Map(items.map((i) => [i.label, i]));

  expect(byLabel.get('新しいシェルタブ')?.accelerator).toBe('Cmd+T');
  // 分割（Issue #56 PR 4）。「新しいシェルタブ」の直下（design-review.md 提案 B'）。
  expect(byLabel.get('右に分割')?.accelerator).toBe('Cmd+D');
  expect(byLabel.get('下に分割')?.accelerator).toBe('Cmd+Shift+D');
  expect(byLabel.get('新しい Claude タブ')?.accelerator).toBe('Cmd+Shift+C');
  // gemini は Cmd+Shift+E（Issue #62）。Cmd+Shift+G は macOS 全域の「前を検索」の
  // 標準キーで、検索中に反射で押すと本物の gemini が1本余計に起動する事故があった。
  expect(byLabel.get('新しい Gemini タブ')?.accelerator).toBe('Cmd+Shift+E');
  // Cmd+W は「ペインを閉じる」に意味が変わった（意味変更。design-review.md
  // 「確定している仕様」。1枚しか無ければ結果としてタブが閉じる）。
  expect(byLabel.get('ペインを閉じる')?.accelerator).toBe('Cmd+W');
  // 「タブを閉じる」はメニュー専用になり、キーは持たない（Cmd+Shift+W は
  // macOS 全域で「ウィンドウを閉じる」と学習されているため新設しない。
  // design-review.md「却下した提案」）。起動直後はタブが1枚だけなので
  // ラベルに「（N ペイン）」は付かない（menu.ts の updateCloseTabLabel 参照）。
  // Electron は accelerator 未指定の MenuItem を読むと null を返す（undefined ではない）。
  expect(byLabel.get('タブを閉じる')?.accelerator).toBeNull();
  expect(byLabel.get('ターミナル内を検索')?.accelerator).toBe('Cmd+F');
  // 次を検索 / 前を検索も Issue #62 で追加。前を検索が Cmd+Shift+G を引き取っている。
  expect(byLabel.get('次を検索')?.accelerator).toBe('Cmd+G');
  expect(byLabel.get('前を検索')?.accelerator).toBe('Cmd+Shift+G');
  expect(byLabel.get('設定...')?.accelerator).toBe('Cmd+,');

  // Cmd+K は「画面を消去」。iTerm2 / Terminal.app / Ghostty と揃える。
  // ここが AI CLI の起動に割り当てられていると、クリアのつもりで押した人が
  // 本物の claude を1本余計に起動することになる。
  expect(byLabel.get('画面を消去')?.accelerator).toBe('Cmd+K');

  // 3. メニュー項目の click を Main プロセス側で直接呼び、Renderer に届くことを見る。
  const tabs = window.locator('.tab-bar__tab');
  await expect(tabs).toHaveCount(1, { timeout: 15_000 });

  const clicked = await launched.app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu();
    if (!menu) return false;
    let target: Electron.MenuItem | undefined;
    const walk = (menuItems: Electron.MenuItem[]): void => {
      for (const item of menuItems) {
        if (item.label === '新しいシェルタブ') target = item;
        if (item.submenu) walk(item.submenu.items);
      }
    };
    walk(menu.items);
    if (!target?.click) return false;
    target.click();
    return true;
  });

  expect(clicked).toBe(true);
  await expect(tabs).toHaveCount(2, { timeout: 10_000 });
});
