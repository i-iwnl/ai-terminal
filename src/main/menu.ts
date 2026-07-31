// アプリケーションメニュー。
//
// **このファイルが「押せるキー」の唯一の正。**
// Electron の既定メニューをそのまま使うと、View > Reload（Cmd+R）が生きたままになる。
// ターミナルアプリでこれを押されると Renderer が再読み込みされ、**全タブの xterm と
// スクロールバックが消える**（PTY は Main 側で生きているので、表示だけが失われる）。
// 開発時だけ再読み込みを残し、本番のメニューからは外す。
//
// もう1つの役割は発見可能性。macOS でショートカットを見つける正規の場所はメニューバーで、
// ここに載っていないキーは「存在しない」のと同じ（VoiceOver のメニュー走査でも辿れない）。

import { app, ipcMain, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { IpcEvent, IpcSend, type AppAction } from '@shared/ipc';
import { openSettingsWindow } from './settings-window';

const REPOSITORY_URL = 'https://github.com/i-iwnl/ai-terminal';

/**
 * 「タブを閉じる」メニュー項目の id。`Menu.getMenuItemById()` で後から引いて
 * ラベルを書き換えるための目印（Issue #56 PR 4。ペイン数が動くたびに
 * 「タブを閉じる（N ペイン）」の N を更新する。updateCloseTabLabel 参照）。
 */
const CLOSE_TAB_MENU_ITEM_ID = 'file-close-tab';

/** 直近に構築したメニューの「タブを閉じる」項目。ウィンドウ再生成のたびに張り直す。 */
let closeTabMenuItem: Electron.MenuItem | null = null;

function closeTabLabel(paneCount: number): string {
  return paneCount > 1 ? `タブを閉じる（${paneCount} ペイン）` : 'タブを閉じる';
}

/**
 * アクティブなタブのペイン数に応じて「タブを閉じる」のラベルを書き換える。
 * 何本の PTY が失われるかをメニューの時点で見せるための仕掛け
 * （design-review.md「確定している仕様」）。メニューがまだ構築されていない
 * 一瞬（起動直後）は黙って何もしない。
 */
export function updateCloseTabLabel(paneCount: number): void {
  if (!closeTabMenuItem) return;
  closeTabMenuItem.label = closeTabLabel(paneCount);
}

/** 開発起動かどうか。index.ts の判定と揃えてある */
function isDev(): boolean {
  return Boolean(process.env.ELECTRON_RENDERER_URL);
}

/**
 * メニュー項目を1つ作る。クリックされたら Renderer へ操作を push する。
 * メニューとキーボードで同じ AppAction を流すので、Renderer 側の処理は1本で済む。
 *
 * **`registerAccelerator: false` が要点。** キーは「表示するだけ」で、実際に拾うのは
 * Renderer の `matchShortcut()` に一本化する。両方が同じキーを登録すると、
 * Cmd+T 一回で新しいタブが2枚開くような二重発火になりうる。
 * 発見可能性（メニューにキーが載っていること）と、単一の発火経路を両立させるための指定。
 */
function actionItem(
  win: BrowserWindow,
  label: string,
  accelerator: string | undefined,
  action: AppAction,
): MenuItemConstructorOptions {
  return {
    label,
    accelerator,
    registerAccelerator: false,
    click: () => {
      if (win.isDestroyed()) return;
      win.webContents.send(IpcEvent.menuAction, action);
    },
  };
}

function buildTemplate(win: BrowserWindow): MenuItemConstructorOptions[] {
  const appName = app.getName();

  const viewSubmenu: MenuItemConstructorOptions[] = [
    actionItem(win, '画面を消去', 'Cmd+K', { type: 'clear-terminal' }),
    { type: 'separator' },
    // ペインの最大化トグル（Issue #56 PR 8・design-review.md 提案 I）。
    // ドラッグ 2〜5回/日 に対し最大化 10〜30回/日（ヘビーユーザーの実測）。
    // 木は一切変えない一時的な表示切り替えで、PTY も kill しない。
    actionItem(win, 'ペインを最大化', 'Cmd+Shift+Enter', { type: 'toggle-maximize-pane' }),
    { type: 'separator' },
    // ペイン間の移動（design-review.md 提案 B'）。Issue 本文の表は
    // 「次 / 前のペイン | Cmd+] / Cmd+[ を第一に、Cmd+Option+矢印 を併設
    // （4方向 = 4項目） | 表示」で、「メニュー」列は行全体に掛かる。
    // 「4方向 = 4項目」は Cmd+Option+矢印 側の注記（メニューの accelerator は
    // 1項目1つなので「次のペイン」1項目には4方向のキーが載らず4項目に
    // 分ける、という意味）であって、**`Cmd+]` / `Cmd+[` をメニューから
    // 外す指示ではない**。`Cmd+]` / `Cmd+[` は「第一」と明記された割り当てで、
    // それだけがメニューに載らない状態は Issue #22（ショートカットがメニューに
    // 1つも載っておらず発見できない）の再発になる。次/前を先に置き、
    // 4方向をその後に続ける。
    actionItem(win, '次のペインへ', 'Cmd+]', { type: 'next-pane' }),
    actionItem(win, '前のペインへ', 'Cmd+[', { type: 'previous-pane' }),
    actionItem(win, '上のペインへ移動', 'Cmd+Option+Up', {
      type: 'move-pane-focus',
      direction: 'up',
    }),
    actionItem(win, '下のペインへ移動', 'Cmd+Option+Down', {
      type: 'move-pane-focus',
      direction: 'down',
    }),
    actionItem(win, '左のペインへ移動', 'Cmd+Option+Left', {
      type: 'move-pane-focus',
      direction: 'left',
    }),
    actionItem(win, '右のペインへ移動', 'Cmd+Option+Right', {
      type: 'move-pane-focus',
      direction: 'right',
    }),
    { type: 'separator' },
    { role: 'resetZoom', label: '実際のサイズ' },
    { role: 'zoomIn', label: '拡大' },
    { role: 'zoomOut', label: '縮小' },
    { type: 'separator' },
    // スプリッタの分割比調整（Issue #56 PR 7・design-review.md 提案 D'）。
    // スプリッタの当たり判定は 8px しかなく、WCAG 2.5.7（ドラッグ動作）と
    // 2.5.8（ターゲットサイズ 24x24）のどちらも単体では満たせない。この3項目が
    // ドラッグの Equivalent（同等の操作手段）として両方の根拠になる。
    // キーは割り当てない（ドラッグの代替であることが目的で、頻度の高い専用
    // ショートカットを新設する理由が無いため。design-review.md はこの3項目に
    // accelerator を要求していない）。
    actionItem(win, '分割比を広げる', undefined, { type: 'adjust-split-ratio', adjustment: 'widen' }),
    actionItem(win, '分割比を狭める', undefined, { type: 'adjust-split-ratio', adjustment: 'narrow' }),
    actionItem(win, '分割比を50%に戻す', undefined, { type: 'adjust-split-ratio', adjustment: 'reset' }),
    { type: 'separator' },
    { role: 'togglefullscreen', label: 'フルスクリーン' },
  ];

  // 再読み込みと DevTools は開発時のみ。
  // 本番に残すと Cmd+R で全タブのスクロールバックが消える事故になる。
  if (isDev()) {
    viewSubmenu.push(
      { type: 'separator' },
      { role: 'reload', label: '再読み込み（開発用）' },
      { role: 'toggleDevTools', label: 'DevTools（開発用）' },
    );
  }

  return [
    {
      label: appName,
      submenu: [
        { role: 'about', label: `${appName} について` },
        { type: 'separator' },
        {
          label: '設定...',
          accelerator: 'Cmd+,',
          // 設定は独立ウィンドウなので Main 側で完結する（Renderer を経由しない）。
          registerAccelerator: false,
          click: () => openSettingsWindow(win.isDestroyed() ? null : win),
        },
        { type: 'separator' },
        { role: 'services', label: 'サービス' },
        { type: 'separator' },
        { role: 'hide', label: `${appName} を隠す` },
        { role: 'hideOthers', label: 'ほかを隠す' },
        { role: 'unhide', label: 'すべてを表示' },
        { type: 'separator' },
        { role: 'quit', label: `${appName} を終了` },
      ],
    },
    {
      label: 'ファイル',
      submenu: [
        actionItem(win, '新しいシェルタブ', 'Cmd+T', { type: 'new-shell-tab' }),
        // 分割は「新しいシェルタブ」の直下（design-review.md 提案 B'）。
        // 分割で作るのはシェルペインが主用途で、「新しいターミナルを作る」操作の
        // 仲間として「表示」ではなく「ファイル」に置く。
        actionItem(win, '右に分割', 'Cmd+D', { type: 'split-pane', dir: 'row' }),
        actionItem(win, '下に分割', 'Cmd+Shift+D', { type: 'split-pane', dir: 'column' }),
        actionItem(win, '新しい Claude タブ', 'Cmd+Shift+C', { type: 'new-claude-tab' }),
        // gemini は Cmd+Shift+E（g-E-mini の E）。Cmd+Shift+G は macOS 全域の
        // 「前を検索」の標準キーなので、Issue #62 でそちらへ明け渡した
        // （検索中に反射で押すと本物の gemini が1本余計に起動していた）。
        actionItem(win, '新しい Gemini タブ', 'Cmd+Shift+E', { type: 'new-gemini-tab' }),
        { type: 'separator' },
        // Cmd+W は「ペインを閉じる」に意味を持つ（意味変更。1枚しか無ければ
        // 結果としてタブが閉じる。useTabs.ts の closeActivePane 参照）。
        actionItem(win, 'ペインを閉じる', 'Cmd+W', { type: 'close-pane' }),
        // 「タブを閉じる」は明示的にタブ全体（何本の PTY が動いていても全部）を
        // 閉じる操作で、**キーは持たない**（design-review.md「却下した提案」:
        // Cmd+Shift+W は macOS 全域で「ウィンドウを閉じる」と学習されているため
        // 新設しない。メニューだけが入口）。ラベルの N はアクティブなタブの
        // ペイン数に応じて updateCloseTabLabel が書き換える。
        { ...actionItem(win, closeTabLabel(1), undefined, { type: 'close-tab' }), id: CLOSE_TAB_MENU_ITEM_ID },
      ],
    },
    {
      label: '編集',
      submenu: [
        { role: 'undo', label: '取り消す' },
        { role: 'redo', label: 'やり直す' },
        { type: 'separator' },
        { role: 'cut', label: 'カット' },
        { role: 'copy', label: 'コピー' },
        { role: 'paste', label: 'ペースト' },
        { role: 'selectAll', label: 'すべてを選択' },
        { type: 'separator' },
        actionItem(win, 'ターミナル内を検索', 'Cmd+F', { type: 'toggle-search' }),
        actionItem(win, '次を検索', 'Cmd+G', { type: 'find-next' }),
        actionItem(win, '前を検索', 'Cmd+Shift+G', { type: 'find-previous' }),
      ],
    },
    { label: '表示', submenu: viewSubmenu },
    {
      label: 'ウィンドウ',
      submenu: [
        { role: 'minimize', label: 'しまう' },
        { role: 'zoom', label: '拡大／縮小' },
        { type: 'separator' },
        { role: 'front', label: 'すべてを手前に移動' },
      ],
    },
    {
      role: 'help',
      label: 'ヘルプ',
      submenu: [
        {
          label: 'リポジトリを開く',
          click: () => {
            void shell.openExternal(REPOSITORY_URL);
          },
        },
      ],
    },
  ];
}

/**
 * アプリケーションメニューを組み立てて適用する。
 * ウィンドウ生成後に1度だけ呼ぶ（ウィンドウを作り直したときは張り直しも必要。
 * index.ts の app.on('activate') 参照）。
 */
export function registerApplicationMenu(win: BrowserWindow): void {
  const menu = Menu.buildFromTemplate(buildTemplate(win));
  Menu.setApplicationMenu(menu);
  closeTabMenuItem = menu.getMenuItemById(CLOSE_TAB_MENU_ITEM_ID);
}

/**
 * Renderer からのペイン数通知を受けて「タブを閉じる」のラベルを更新する IPC ハンドラ。
 * ウィンドウ生成とは独立に、アプリ起動時に1度だけ登録すればよい
 * （registerApplicationMenu と違い、ウィンドウを作り直しても登録し直す必要は無い）。
 */
export function registerMenuHandlers(): void {
  ipcMain.on(IpcSend.menuPaneCount, (_event, paneCount: unknown) => {
    if (typeof paneCount !== 'number') return;
    updateCloseTabLabel(paneCount);
  });
}
