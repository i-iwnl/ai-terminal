// OS の支援技術（VoiceOver 等）が動いているかを Renderer へ伝える。
//
// ターミナルの内容は WebGL レンダラが canvas に描くため、DOM にテキストが1文字も
// 存在しない。xterm の screenReaderMode を有効にすると読み上げ用の DOM が別に生えるが、
// 行が追加されるたびに live region を更新するので描画コストが上がる。
// そのため既定は false（設定で明示的に有効化する）にしたうえで、**VoiceOver が
// 動いていることを検知できたときは設定に関わらず有効にする**。
//
// 設定の存在を知らないユーザーでも読める状態になる、というのがこの自動検知の狙い。

import { app, BrowserWindow, ipcMain } from 'electron';
import { IpcEvent, IpcInvoke } from '@shared/ipc';

/**
 * 支援技術の状態を扱う IPC を登録する。
 *
 * `accessibility-support-changed` は macOS / Windows でのみ発火する。
 * 発火しない環境では初期値だけが使われる（縮退しても壊れない）。
 *
 * **宛先はイベントのたびに解決する（Issue #149）。** 以前は登録時のウィンドウを
 * 閉包で掴んでいたが、それには2つの穴があった。
 *
 *   1. **設定ウィンドウに届かない。** 本体ウィンドウ1枚にしか送らないので、
 *      設定を開いたまま支援技術を起動・終了しても表示が追従しない
 *   2. ⭐ **本体ウィンドウを作り直すと、二度と届かなくなる。** `index.ts` の
 *      `app.on('activate')` は全ウィンドウを閉じたあとに本体を作り直すが、
 *      掴んでいるのは**最初のウィンドウ**なので、以後は `isDestroyed()` で
 *      永久に early return する。しかも `ipcMain.handle` は二重登録で throw するため、
 *      **この関数を呼び直して張り直すこともできなかった**
 *
 * `src/main/config.ts` の `broadcastConfig` が同じ形（全ウィンドウへ配る）で、
 * 実装パターンもそれに揃えてある。
 */
export function registerAccessibilityHandlers(): void {
  ipcMain.handle(IpcInvoke.appAccessibilitySupport, () => app.accessibilitySupportEnabled);

  app.on('accessibility-support-changed', (_event, enabled) => {
    // 破棄済みの判定は**ウィンドウごとに**行う（1枚でも死んでいると
    // 残りへ配れない、という形にしない）。
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      win.webContents.send(IpcEvent.accessibilitySupportChanged, enabled);
    }
  });
}
