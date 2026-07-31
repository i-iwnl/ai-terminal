import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { SURFACE } from '@shared/defaults';

import { registerPtyHandlers, disposePtyAll } from './pty/manager';
import { registerAgentHandlers } from './agents/poller';
import { registerHistoryHandlers } from './history/reader';
import { registerSessionTitleHandlers } from './history/titles';
import { registerMemoHandlers } from './memo/store';
import { registerConfigHandlers } from './config';
import { registerNotifyHandlers } from './notify';
import { registerAppPathHandlers } from './app-paths';
import { registerApplicationMenu, registerMenuHandlers } from './menu';
import { registerAccessibilityHandlers } from './accessibility';
import { registerSettingsWindowHandlers } from './settings-window';
import { ensureLoginShellPath } from './shell-path';

// dev 起動（非パッケージ実行）と安定版 .app の userData を分離する。
// 同じ productName を共有するため、分けないと同時起動時に localStorage や
// GPU キャッシュのロックを取り合う。E2E は --user-data-dir でテストごとの
// 一時ディレクトリを指定してくるので、その場合は尊重して触らない。
if (!app.isPackaged && !app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', `${app.getPath('userData')}-dev`);
}

// Finder 起動では launchd の最小 PATH しか継承しないため、ログインシェルの PATH を
// 補完する。Electron の初期化と並行して始め、IPC ハンドラ登録前（= claude / gemini を
// 探しに行く前）に await で確定させる。
const shellPathReady = ensureLoginShellPath();

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
    // ライブリサイズ中に macOS が塗る色。CSS の --surface-1 とずれると、
    // ウィンドウを掴んで動かしている間だけ違う色の帯が見える。
    backgroundColor: SURFACE.base,
    webPreferences: {
      // package.json が "type": "module" のため、electron-vite は preload を
      // ESM（.mjs）として出力する。拡張子を .js にすると読み込みに失敗する。
      // ESM の preload は sandbox: false のときのみ有効（下の設定と対になっている）。
      preload: join(__dirname, '../preload/index.mjs'),
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

    // 開発時は DevTools を自動で開く。
    // ターミナルの表示領域を狭めないよう別ウィンドウ（detach）で開く。
    // 邪魔なときは AI_TERMINAL_NO_DEVTOOLS=1 を付けて起動すれば抑制できる。
    if (!process.env.AI_TERMINAL_NO_DEVTOOLS) {
      win.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

void app.whenReady().then(async () => {
  // PATH が確定する前にポーリングや PTY 起動が走ると ENOENT になるため、ここで待つ。
  // ensureLoginShellPath はタイムアウト付きで、失敗しても resolve する（起動を止めない）。
  await shellPathReady;

  mainWindow = createWindow();

  // 既定メニューを自前のものに差し替える。
  // 差し替えないと View > Reload（Cmd+R）が生き、押すと全タブの表示が消える。
  registerApplicationMenu(mainWindow);

  // 各モジュールの IPC ハンドラ登録。
  registerPtyHandlers();
  registerAgentHandlers(mainWindow);
  registerHistoryHandlers();
  registerSessionTitleHandlers();
  registerMemoHandlers();
  registerConfigHandlers();
  registerNotifyHandlers();
  registerAppPathHandlers();
  registerAccessibilityHandlers(mainWindow);
  registerSettingsWindowHandlers(() => mainWindow);
  registerMenuHandlers();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
      // メニュー項目は生成時のウィンドウを掴んでいるので、作り直したら張り直す。
      // 忘れると、再表示後にメニューから何を選んでも無反応になる。
      registerApplicationMenu(mainWindow);
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
