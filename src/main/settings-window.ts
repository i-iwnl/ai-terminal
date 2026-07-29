// 設定ウィンドウ。
//
// macOS 13 以降の作法では、アプリ全体に効く設定は**独立した非モーダルのウィンドウ**。
// モーダルシートは「この書類に対する不可逆な決定」に使うもので、Webhook URL の入力には重い。
//
// モーダルをやめたことで、フォーカストラップ・Esc の自前処理・背景クリック判定・
// backdrop がすべて不要になった。あわせて、モーダルを宣言しながらフォーカスを
// 移していなかったために**設定を開いた直後のキー入力が PTY へ流れていた不具合**
// （Issue #25）も、構造ごと消えている。
//
// 本体と同じバンドルを `#settings` 付きで読み込む。ビルドの入力（HTML）を
// 増やさずに2つ目のウィンドウを作るための割り切り。

import { join } from 'node:path';
import { BrowserWindow, ipcMain } from 'electron';
import { IpcSend } from '@shared/ipc';
import { SURFACE } from '@shared/defaults';

let settingsWindow: BrowserWindow | null = null;

/** 設定ウィンドウを開く。既に開いていれば前に出すだけ（多重に開かない）。 */
export function openSettingsWindow(parent: BrowserWindow | null): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) settingsWindow.restore();
    settingsWindow.focus();
    return;
  }

  const win = new BrowserWindow({
    width: 520,
    height: 640,
    // 設定は縦に伸びるので高さは変えられるようにし、横幅は固定する。
    minWidth: 520,
    maxWidth: 520,
    minHeight: 360,
    title: '設定',
    show: false,
    // 非モーダル。親を指定するとウィンドウの前後関係だけが揃い、
    // 本体の操作は妨げない（modal: true にしない）。
    parent: parent ?? undefined,
    // 開いた瞬間の塗り。CSS の --surface-3（.settings--window の背景）と揃える。
    backgroundColor: SURFACE.raised,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  settingsWindow = win;

  win.once('ready-to-show', () => {
    win.show();
  });
  win.on('closed', () => {
    settingsWindow = null;
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#settings`);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'settings' });
  }
}

/** 設定ウィンドウを閉じる。開いていなければ何もしない。 */
export function closeSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
}

/**
 * Renderer からの開閉要求を受ける。
 * 開く指示は本体ウィンドウ（Cmd+, / 設定ボタン）から、
 * 閉じる指示は設定ウィンドウ自身（Esc / Cmd+W）から来る。
 */
export function registerSettingsWindowHandlers(getParent: () => BrowserWindow | null): void {
  ipcMain.on(IpcSend.settingsOpen, () => openSettingsWindow(getParent()));
  ipcMain.on(IpcSend.settingsClose, () => closeSettingsWindow());
}
