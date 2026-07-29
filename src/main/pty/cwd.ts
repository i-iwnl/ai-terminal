// 走っているプロセスの「いま居るディレクトリ」を読む。
//
// シェルタブで `cd` した先を追跡するために使う。**シェル側に何も仕込まない**のが要点で、
// OSC 7（cwd を通知するエスケープシーケンス）は macOS 既定の zsh が出さないため採らなかった
// （出させるにはユーザーの .zshrc を書き換えるか、PTY の出力を横取りして解釈することになる。
// どちらもルート CLAUDE.md の鉄則2「PTY の出力は加工しない」の周辺にあり、避けたい）。
//
// 代わりに OS にプロセスの cwd を聞く。macOS には /proc が無いので lsof を使う。
// Linux（devcontainer など）では /proc/<pid>/cwd の symlink を読めるので、そちらを優先する。
//
// 取得に失敗しても例外を投げない。呼び出し側は undefined を受け取ったら直前の値を維持する
// （外部コマンドの失敗でアプリの状態を壊さない）。

import { execFile } from 'node:child_process';
import { readlink } from 'node:fs/promises';

/** lsof の呼び出しがこの時間内に返らなければ諦める。追跡は「できたら嬉しい」機能なので待たない。 */
const LSOF_TIMEOUT_MS = 1_500;

/**
 * `lsof -a -d cwd -p <pid> -Fn` の出力から cwd を取り出す。
 *
 * -F は機械可読の出力形式で、1行1フィールド・行頭1文字がフィールド種別になる:
 *
 * ```
 * p12345      <- プロセス ID
 * fcwd        <- ファイルディスクリプタ（cwd）
 * n/Users/foo/work   <- 名前（= 求めるパス）
 * ```
 *
 * `n` 行は cwd 以外にも現れうるため、**`fcwd` の直後の `n` 行だけ**を採用する。
 * 該当が無ければ undefined（呼び出し側が直前の値を維持する）。
 */
export function parseLsofCwd(stdout: string): string | undefined {
  let inCwdEntry = false;
  for (const line of stdout.split('\n')) {
    if (line.startsWith('f')) {
      inCwdEntry = line === 'fcwd';
      continue;
    }
    if (inCwdEntry && line.startsWith('n')) {
      const path = line.slice(1).trim();
      return path.length > 0 ? path : undefined;
    }
  }
  return undefined;
}

/** lsof を1回だけ呼ぶ。失敗・タイムアウトは undefined に倒す。 */
function runLsof(pid: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      'lsof',
      ['-a', '-d', 'cwd', '-p', String(pid), '-Fn'],
      { timeout: LSOF_TIMEOUT_MS, encoding: 'utf8' },
      (err, stdout) => {
        // lsof は対象プロセスが既に終わっていると非 0 で終わる。異常ではないので黙って諦める。
        if (err && !stdout) {
          resolve(undefined);
          return;
        }
        resolve(parseLsofCwd(stdout));
      },
    );
  });
}

/**
 * 指定した PID のプロセスの作業ディレクトリ。取得できなければ undefined。
 * 例外は投げない。
 */
export async function readProcessCwd(pid: number): Promise<string | undefined> {
  if (!Number.isInteger(pid) || pid <= 0) return undefined;

  // Linux 系では symlink を読むだけで済む（lsof が入っていない環境でも動く）。
  if (process.platform === 'linux') {
    try {
      return await readlink(`/proc/${pid}/cwd`);
    } catch {
      return undefined;
    }
  }

  try {
    return await runLsof(pid);
  } catch {
    return undefined;
  }
}
