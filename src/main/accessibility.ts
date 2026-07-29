// OS の支援技術（VoiceOver 等）が動いているかを Renderer へ伝える。
//
// ターミナルの内容は WebGL レンダラが canvas に描くため、DOM にテキストが1文字も
// 存在しない。xterm の screenReaderMode を有効にすると読み上げ用の DOM が別に生えるが、
// 行が追加されるたびに live region を更新するので描画コストが上がる。
// そのため既定は false（設定で明示的に有効化する）にしたうえで、**VoiceOver が
// 動いていることを検知できたときは設定に関わらず有効にする**。
//
// 設定の存在を知らないユーザーでも読める状態になる、というのがこの自動検知の狙い。

import { app, ipcMain, type BrowserWindow } from 'electron';
import { IpcEvent, IpcInvoke } from '@shared/ipc';

/**
 * 支援技術の状態を扱う IPC を登録する。
 *
 * `accessibility-support-changed` は macOS / Windows でのみ発火する。
 * 発火しない環境では初期値だけが使われる（縮退しても壊れない）。
 */
export function registerAccessibilityHandlers(win: BrowserWindow): void {
  ipcMain.handle(IpcInvoke.appAccessibilitySupport, () => app.accessibilitySupportEnabled);

  app.on('accessibility-support-changed', (_event, enabled) => {
    if (win.isDestroyed()) return;
    win.webContents.send(IpcEvent.accessibilitySupportChanged, enabled);
  });
}
