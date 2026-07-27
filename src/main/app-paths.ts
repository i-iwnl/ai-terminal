// Renderer に基準となる絶対パスを渡すためのハンドラ。
//
// Renderer は contextIsolation により Node API に触れないため、
// 「アプリを起動したディレクトリ」「ホームディレクトリ」を Main 側から供給する。
// 履歴一覧の探索キー（~/.claude/projects の照合に使う cwd）はこれが無いと解決できない。

import { ipcMain } from 'electron';
import { homedir } from 'node:os';

import { IpcInvoke, type AppPaths } from '@shared/ipc';

export function getAppPaths(): AppPaths {
  return {
    cwd: process.cwd(),
    home: homedir(),
  };
}

export function registerAppPathHandlers(): void {
  ipcMain.handle(IpcInvoke.appPaths, (): AppPaths => getAppPaths());
}
