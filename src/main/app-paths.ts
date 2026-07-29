// Renderer に基準となる絶対パスを渡すためのハンドラ。
//
// Renderer は contextIsolation により Node API に触れないため、
// 「アプリを起動したディレクトリ」「ホームディレクトリ」を Main 側から供給する。
// 履歴一覧の探索キー（~/.claude/projects の照合に使う cwd）はこれが無いと解決できない。

import { ipcMain } from 'electron';
import { homedir } from 'node:os';

import { IpcInvoke, type AppPaths } from '@shared/ipc';

/**
 * 起動時の作業ディレクトリを、履歴の探索キーとして意味のある値に倒す。
 *
 * **Finder / Dock から起動した macOS アプリの `process.cwd()` は `/` になる。**
 * 履歴ディレクトリ名は cwd の絶対パスから機械的に作られる（`~/.claude/projects/-Users-...`）ため、
 * `/` はどのセッションにも当たらず、**何百セッションあっても履歴一覧が確実に空になる**。
 * ホームなら当たる可能性があり、当たらなくてもシェルタブで `cd` すれば追従する
 * （cwd の追跡は src/main/pty/cwd.ts と src/renderer/src/lib/cwd.ts）。
 */
export function resolveLaunchCwd(cwd: string, home: string): string {
  if (!cwd || cwd === '/') return home;
  return cwd;
}

export function getAppPaths(): AppPaths {
  const home = homedir();
  return {
    cwd: resolveLaunchCwd(process.cwd(), home),
    home,
  };
}

export function registerAppPathHandlers(): void {
  ipcMain.handle(IpcInvoke.appPaths, (): AppPaths => getAppPaths());
}
