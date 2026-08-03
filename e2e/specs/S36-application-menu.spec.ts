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
  //
  // **`role` は小文字で返る。** Electron の `MenuItem.role` は指定した綴りを
  // そのまま返さず、正規化した小文字を返す（実測: `hideOthers` -> `hideothers`、
  // `toggleDevTools` -> `toggledevtools`）。
  //
  // **この spec は Issue #120 周1 まで、そこを取り違えていた。**
  // `not.toContain('forceReload')` と `not.toContain('toggleDevTools')` は
  // **一度も機能していなかった**（キャメルケースの文字列は決して一致しないので、
  // 実際にその role を足しても緑のまま通る）。効いていたのは元から小文字だった
  // `'reload'` の1つだけ。**小文字へ正規化してから比べる。**
  const roles = items.map((i) => i.role?.toLowerCase());
  expect(roles).not.toContain('reload');
  expect(roles).not.toContain('forcereload');
  expect(roles).not.toContain('toggledevtools');

  // 1-b. **Electron の zoom 系の `role` が1つも無いこと**（Issue #120 周1）。
  //
  // `role: 'zoomIn' / 'zoomOut' / 'resetZoom'` は `actionItem()` を通らないため
  // `registerAccelerator: false` が付かず、**このファイル（menu.ts）が謳う
  // 「キーを実際に拾うのは matchShortcut 1箇所。メニューは表示するだけ」という
  // 原則の唯一の例外**だった。実際に `Cmd+-` / `Cmd+0` を押すと Renderer 全体の
  // 拡大率が変わり、しかも config.json に保存されないので次回起動で戻っていた。
  //
  // 周1 で「ターミナルの文字サイズ」を同じキーに割り当てたので、**残っていると
  // 同じキーが2系統から発火する。** ここで1つでも復活したら赤くなる。
  expect(roles).not.toContain('zoomin');
  expect(roles).not.toContain('zoomout');
  expect(roles).not.toContain('resetzoom');

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
  // 「タブを閉じる」は **Issue #120 周1 で `Cmd+Option+W` を得た**。
  // それまではキーが無く、分割中のタブを閉じるにはペインの枚数ぶん `Cmd+W` を
  // 押すかメニューをマウスで辿るしかなかった（他ターミナルの筋肉記憶では
  // `Cmd+W` 一発でタブが消えるので「閉じたつもりが半分残る」）。
  // `Cmd+Shift+W` は macOS 全域で「ウィンドウを閉じる」と学習されているので使わない。
  // 起動直後はタブが1枚だけなのでラベルに「（N ペイン）」は付かない
  // （menu.ts の updateCloseTabLabel 参照）。
  expect(byLabel.get('タブを閉じる')?.accelerator).toBe('Cmd+Option+W');
  // ターミナルの文字サイズ（Issue #120 周1）。**Electron の zoom を置き換えたもの。**
  // こちらは `AppConfig.fontSize` を動かすので config.json に保存され、
  // xterm の文字だけが変わる（サイドバー・タブバーは動かない）。
  expect(byLabel.get('文字を大きく')?.accelerator).toBe('Cmd+=');
  expect(byLabel.get('文字を小さく')?.accelerator).toBe('Cmd+-');
  expect(byLabel.get('文字サイズを既定に戻す')?.accelerator).toBe('Cmd+0');
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
