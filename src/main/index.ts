import { join } from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import { SURFACE } from '@shared/defaults';
import { IpcEvent, IpcSend } from '@shared/ipc';
import { BAR_HEIGHT_PX, TRAFFIC_LIGHT_X_PX, trafficLightY } from '@shared/windowChrome';

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
import { applyFullScreenState, trackWindowState, windowStateOptions } from './window-state';

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
    // 位置・サイズは前回終了時の状態から復元する（Issue #119 周5 / #20 の K-9）。
    // 保存先は `window-state.json`（`config.json` ではない。理由は window-state.ts）。
    // 外部ディスプレイを外したあとなど、保存された位置が今の画面構成で
    // 見えない場合は位置だけ捨てて中央に落ちる。
    ...windowStateOptions(),
    minWidth: 640,
    minHeight: 400,
    show: false,
    // ターミナルアプリらしい見た目（macOS の信号機ボタンをタイトルバーに埋め込む）
    titleBarStyle: 'hiddenInset',
    // 値の導出は `src/shared/windowChrome.ts` が唯一の正
    // （**Electron に `trafficLightPosition` を読み戻す API が無い**ので、
    // 揃っていることを実行時に観測できない。だから導出を1箇所に集めて
    // `test/unit/css-tokens.test.ts` で固定する）。
    // これで信号機の光学中心・`.sidebar__drag-region` の中心・タブバーのテキスト
    // 中心が3つとも 18 に揃う。周5 まで y: 16 で、3つとも別々の高さにあった（#20 K-4）。
    trafficLightPosition: { x: TRAFFIC_LIGHT_X_PX, y: trafficLightY(BAR_HEIGHT_PX) },
    // ライブリサイズ中に macOS が塗る色。CSS の --surface-1 とずれると、
    // ウィンドウを掴んで動かしている間だけ違う色の帯が見える。
    backgroundColor: SURFACE.base,
    // Issue #20 K-7。
    //
    // **訂正（Issue #119 周5・実機で測定）: この指定は現状ではまったく効いていない。**
    //
    // vibrancy はウィンドウの背後に NSVisualEffectView を敷く仕組みで、
    // 見せるには**その上のすべての層が透明**でなければならない。実測では
    // 不透明な層が2枚ある。
    //
    //   1. すぐ下の `backgroundColor: SURFACE.base`（不透明。明示している）
    //   2. `styles.css` の `body { background: var(--surface-1) }`
    //      （`html` に背景が無いのでキャンバスへ伝播する）
    //
    // 実際に見せるには `transparent: true` か `backgroundColor: '#00000000'` が要る。
    // **この周では踏み込まない。** 透明化は「ライブリサイズ中に macOS が塗る色」
    // （下のコメント）と e2e/specs/S40-contrast-contract.spec.ts の前提
    // （サイドバーの文字コントラストがデスクトップの壁紙に依存しない）の両方に
    // 影響する。見た目のために測定済みの保証を崩す取引になるので、やるなら独立した周で。
    //
    // 指定自体は残す（消すと「検討した結果やらない」のか「知らなかった」のかが
    // 分からなくなる。styles.css 側の塗りの構造も同じ理由で残してある）。
    vibrancy: 'sidebar',
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

  // 前回フルスクリーンで終了していたら、**見せる前に**その状態へ戻す
  // （見せたあとに切り替えると、通常サイズのウィンドウが一瞬映る）。
  applyFullScreenState(win);
  trackWindowState(win);

  // フルスクリーン中は macOS が信号機ボタンを隠すので、その下敷きにしている
  // `.sidebar__drag-region` も畳む（残すと**何も無い帯だけがターミナルの上に
  // 居座る**）。Renderer 側の見た目は styles.css の `.app.is-fullscreen` が持つ。
  //
  // **フルスクリーンから戻ると trafficLightPosition が既定位置へリセットされる**
  // という Electron の既知の挙動があるため、復帰時に必ず再適用する
  // （これを忘れると、一度フルスクリーンにしただけで信号機と帯の中心がずれる）。
  const sendFullScreen = (fullScreen: boolean): void => {
    if (!win.isDestroyed()) win.webContents.send(IpcEvent.fullScreenChanged, fullScreen);
  };
  win.on('enter-full-screen', () => sendFullScreen(true));
  win.on('leave-full-screen', () => {
    win.setWindowButtonPosition?.({ x: TRAFFIC_LIGHT_X_PX, y: trafficLightY(BAR_HEIGHT_PX) });
    sendFullScreen(false);
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

  // ウィンドウタイトルをアクティブなタブに同期する（Issue #119 周5 / #20 の K-10）。
  // `titleBarStyle: 'hiddenInset'` なので画面上のタイトルバーには出ないが、
  // **ウィンドウメニュー・Mission Control・App Exposé には出る**（そこだけが
  // 「どのウィンドウがどのプロジェクトか」を見分ける手がかりになる）。
  ipcMain.on(IpcSend.windowSetTitle, (_event, title: unknown) => {
    if (typeof title !== 'string') return;
    // 空文字にすると Electron が既定（package.json の productName）へ戻すので、
    // タブ名が空のときは何もしない。
    if (title.trim() === '') return;
    mainWindow?.setTitle(title);
  });

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
