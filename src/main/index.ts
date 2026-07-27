import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';

import { registerPtyHandlers, disposePtyAll } from './pty/manager';
import { registerAgentHandlers } from './agents/poller';
import { registerHistoryHandlers } from './history/reader';
import { registerConfigHandlers } from './config';
import { registerNotifyHandlers } from './notify';
import { registerAppPathHandlers } from './app-paths';

let mainWindow: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 640,
    minHeight: 400,
    show: false,
    // ターミナルアプリらしい見た目（macOS の信号機ボタンをタイトルバーに埋め込む）
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Renderer は OS を直接触らない。contextIsolation を維持し、
      // 必要な IPC だけを preload の contextBridge 経由で露出する。
      contextIsolation: true,
      nodeIntegration: false,
      // preload で Node API（contextBridge 等）を使うため sandbox は無効化する。
      sandbox: false,
    },
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

void app.whenReady().then(() => {
  mainWindow = createWindow();

  // 各モジュールの IPC ハンドラ登録。
  registerPtyHandlers();
  registerAgentHandlers(mainWindow);
  registerHistoryHandlers();
  registerConfigHandlers();
  registerNotifyHandlers();
  registerAppPathHandlers();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// アプリ終了時に全 PTY を後始末する。
app.on('before-quit', () => {
  disposePtyAll();
});
