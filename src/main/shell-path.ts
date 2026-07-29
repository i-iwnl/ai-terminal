// Finder / Dock から起動した .app の PATH 補完。
//
// launchd 経由で起動したアプリは /usr/bin:/bin:/usr/sbin:/sbin 程度の最小 PATH しか
// 継承せず、ログインシェル（~/.zprofile / ~/.zshrc 等）で通した PATH が見えない。
// claude / gemini / tmux はユーザー領域（~/.local/bin や nvm の bin 等）に入っている
// ことが多く、パッケージ版でだけ「コマンドが見つからない」が起きる。
//
// そこで起動時に一度だけログインシェルから PATH を取得し、process.env.PATH に
// 不足分を追記する。PTY 起動（pty/manager.ts）・claude agents のポーリング
// （agents/claude.ts）・gemini 履歴（history/reader.ts）・tmux 判定（pty/tmux.ts）は
// いずれも process.env を参照するため、ここでの1回の反映で全箇所に効く。

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** rc ファイルの対話待ち等でハングしても起動を引きずられないためのタイムアウト。 */
const EXEC_TIMEOUT_MS = 3000;

/** rc ファイルが echo する雑多な出力の中から PATH だけを切り出すための目印。 */
const DELIMITER = '__AI_TERMINAL_PATH__';

/**
 * シェルの出力から、DELIMITER で挟まれた PATH 文字列を取り出す。
 * rc ファイルが標準出力に何を書いていても、目印の間だけを見るので影響を受けない。
 * 目印が揃っていない・中身が空の場合は undefined。
 */
export function extractDelimitedPath(stdout: string, delimiter: string = DELIMITER): string | undefined {
  const start = stdout.indexOf(delimiter);
  if (start === -1) return undefined;
  const rest = stdout.slice(start + delimiter.length);
  const end = rest.indexOf(delimiter);
  if (end === -1) return undefined;
  const path = rest.slice(0, end).trim();
  return path.length > 0 ? path : undefined;
}

/**
 * 現在の PATH を先頭に保ったまま、ログインシェル由来のエントリのうち
 * 足りないものだけを後ろに追記する（重複は除去）。
 *
 * ログインシェル側を先頭にしない理由:
 * - 既に解決できているコマンドの解決先を変えない（動いているものを壊さない）
 * - E2E ハーネスは PATH の先頭に偽 CLI を置いて隔離しており、その優先順位を崩さない
 */
export function mergePathEntries(currentPath: string | undefined, loginPath: string): string {
  const merged: string[] = [];
  for (const entry of [...(currentPath ? currentPath.split(':') : []), ...loginPath.split(':')]) {
    if (entry.length > 0 && !merged.includes(entry)) merged.push(entry);
  }
  return merged.join(':');
}

/**
 * ログインシェルを対話モード（-i -l）で起動して PATH を取得する。
 * zsh は ~/.zshrc を login だけでは読まないため -i も付ける（nvm 等は .zshrc に書かれがち）。
 * シェルが無い・非ゼロ終了・タイムアウトのいずれでも例外は投げず undefined を返す。
 */
async function resolveLoginShellPath(shell: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      shell,
      ['-i', '-l', '-c', `printf '%s' "${DELIMITER}$PATH${DELIMITER}"`],
      { timeout: EXEC_TIMEOUT_MS, windowsHide: true },
    );
    return extractDelimitedPath(stdout);
  } catch (err) {
    console.warn('[shell-path] ログインシェルからの PATH 取得に失敗しました:', err);
    return undefined;
  }
}

/**
 * process.env.PATH にログインシェルの PATH をマージする。起動時に一度だけ呼ぶ。
 * 取得に失敗した場合は何もしない（現状の PATH のまま縮退し、アプリは落とさない）。
 */
export async function ensureLoginShellPath(): Promise<void> {
  if (process.platform !== 'darwin') return;
  const shell = process.env.SHELL || '/bin/zsh';
  const loginPath = await resolveLoginShellPath(shell);
  if (!loginPath) return;
  process.env.PATH = mergePathEntries(process.env.PATH, loginPath);
}
