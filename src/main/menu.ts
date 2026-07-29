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

import { app, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { IpcEvent, type AppAction } from '@shared/ipc';
import { openSettingsWindow } from './settings-window';

const REPOSITORY_URL = 'https://github.com/i-iwnl/ai-terminal';

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
    { role: 'resetZoom', label: '実際のサイズ' },
    { role: 'zoomIn', label: '拡大' },
    { role: 'zoomOut', label: '縮小' },
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
        actionItem(win, '新しい Claude タブ', 'Cmd+Shift+C', { type: 'new-claude-tab' }),
        actionItem(win, '新しい Gemini タブ', 'Cmd+Shift+G', { type: 'new-gemini-tab' }),
        { type: 'separator' },
        actionItem(win, 'タブを閉じる', 'Cmd+W', { type: 'close-tab' }),
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
 * ウィンドウ生成後に1度だけ呼ぶ。
 */
export function registerApplicationMenu(win: BrowserWindow): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildTemplate(win)));
}
