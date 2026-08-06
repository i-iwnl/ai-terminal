// Finder / Dock から起動した .app の PATH 補完。
//
// launchd 経由で起動したアプリは /usr/bin:/bin:/usr/sbin:/sbin 程度の最小 PATH しか
// 継承せず、ログインシェル（~/.zprofile / ~/.zshrc 等）で通した PATH が見えない。
// claude / gemini / tmux はユーザー領域（~/.local/bin や nvm の bin 等）に入っている
// ことが多く、パッケージ版でだけ「コマンドが見つからない」が起きる。
//
// そこで起動時に一度ログインシェルから PATH を取得し、process.env.PATH に
// 不足分を追記する。PTY 起動（pty/manager.ts）・claude agents のポーリング
// （agents/claude.ts）・gemini 履歴（history/reader.ts）・tmux 判定（pty/tmux.ts）は
// いずれも process.env を参照するため、ここでの反映で全箇所に効く。
//
// **同じ1回の起動で env 全体も取る**（PTY へ渡す環境変数の補完に使う。詳細は
// pty/shellEnv.ts）。⛔ **これと別にもう1回ログインシェルを起動しないこと。**
// ユーザーの rc を2回実行することになり、起動も2倍待つ。実際に #180 周11 で
// 一度そうしてしまい、この統合で1回に戻した。
//
// 起動時の解決は一過性の要因（起動直後の負荷・シェルの遅延等）で失敗しうるため、
// 一度きりにしない。ポーリングが「claude が見つからない」を検知したら、抑制付きで
// 再解決を試みる（retryLoginShellPath）。失敗したまま固定させないことが要件。
//
// 解決の成否と結果はデータディレクトリの shell-path.log に毎回記録する。
// パッケージ版は stderr がどこにも出ないため、これが唯一の事後調査手段になる。

import { execFile } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { dataDir } from './data-dir';
import { SHELL_ENV_COMMAND, parseShellEnvOutput } from './pty/shellEnv';

const execFileAsync = promisify(execFile);

/** rc ファイルの対話待ち等でハングしても起動を引きずられないためのタイムアウト。 */
const EXEC_TIMEOUT_MS = 5000;

/** rc ファイルが echo する雑多な出力の中から PATH だけを切り出すための目印。 */
const DELIMITER = '__AI_TERMINAL_PATH__';

/** 再解決の最短間隔。ポーリング（既定3秒）のたびに走らせないための抑制。 */
const RETRY_MIN_INTERVAL_MS = 15_000;

/** 再解決の上限回数。環境自体が壊れている場合に無限に繰り返さない。 */
const RETRY_MAX_ATTEMPTS = 5;

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

/** 再解決の抑制状態。 */
export interface RetryState {
  /** これまでの再解決の試行回数（起動時の解決は数えない）。 */
  attemptCount: number;
  /** 直近の試行開始時刻（epoch ms）。起動時の解決も含む。 */
  lastAttemptAt: number;
  /** 解決処理が実行中かどうか。 */
  inFlight: boolean;
}

/**
 * いま再解決を試みてよいか。入力から出力が閉じた純粋関数（test/unit/shell-path.test.ts）。
 * 実行中は重ねない・最短間隔を空ける・上限回数で打ち切る、の3条件。
 */
export function shouldAttemptRetry(
  state: RetryState,
  nowMs: number,
  minIntervalMs: number = RETRY_MIN_INTERVAL_MS,
  maxAttempts: number = RETRY_MAX_ATTEMPTS,
): boolean {
  if (state.inFlight) return false;
  if (state.attemptCount >= maxAttempts) return false;
  return nowMs - state.lastAttemptAt >= minIntervalMs;
}

/**
 * ログインシェルに渡す「PATH を目印付きで出力する」コマンド文字列を組み立てる。
 *
 * $PATH は必ず ${PATH} とブレース付きで参照すること。`"$PATH__目印__"` と書くと、
 * シェルは `PATH__目印__` 全体を1つの変数名として解釈し（アンダースコアは変数名の
 * 有効文字）、未定義変数として空に展開される。閉じ側の目印ごと消えるため切り出しが
 * 必ず失敗する。実際にこれが原因でパッケージ版の PATH 補完が全く効いていなかった。
 */
export function buildProbeCommand(delimiter: string = DELIMITER): string {
  return `printf '%s' "${delimiter}\${PATH}${delimiter}"; ${SHELL_ENV_COMMAND}`;
}

const retryState: RetryState = { attemptCount: 0, lastAttemptAt: 0, inFlight: false };

/**
 * 直近の解決で得られたログインシェルの env。
 * PTY 起動（pty/manager.ts）が「起動元に無いキー」を埋めるのに使う。
 * 解決前・失敗時は空で、その場合は従来どおりの env で起動する（縮退）。
 */
let loginEnv: Record<string, string> = {};

/** ログインシェルから取れた環境変数。取れていなければ空。 */
export function loginShellEnv(): Record<string, string> {
  return loginEnv;
}

/**
 * 診断ログ（データディレクトリの shell-path.log）へ1行追記する。
 * 書き込み失敗でアプリを止めない。fresh を立てると起動ごとにファイルを作り直す。
 */
function log(line: string, fresh = false): void {
  try {
    const dir = dataDir();
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'shell-path.log');
    const entry = `${new Date().toISOString()} ${line}\n`;
    if (fresh) {
      writeFileSync(file, entry, 'utf8');
    } else {
      appendFileSync(file, entry, 'utf8');
    }
  } catch {
    // 診断ログが書けないことを理由に何も壊さない
  }
}

/**
 * ログインシェルを対話モード（-i -l）で起動して PATH を取得する。
 * zsh は ~/.zshrc を login だけでは読まないため -i も付ける（nvm 等は .zshrc に書かれがち）。
 * 対話モードのシェルは SIGTERM を無視することがあるため、タイムアウト時は SIGKILL で殺す。
 * シェルが無い・非ゼロ終了・タイムアウトのいずれでも例外は投げず undefined を返す。
 */
async function resolveLoginShellPath(shell: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      shell,
      ['-i', '-l', '-c', buildProbeCommand()],
      { timeout: EXEC_TIMEOUT_MS, killSignal: 'SIGKILL', windowsHide: true },
    );
    // env は PATH と独立に扱う。片方が取れなくてももう片方を捨てない。
    const env = parseShellEnvOutput(stdout);
    if (Object.keys(env).length > 0) loginEnv = env;
    const path = extractDelimitedPath(stdout);
    if (!path) log(`シェルの出力から PATH を切り出せませんでした: ${JSON.stringify(stdout.slice(0, 200))}`);
    return path;
  } catch (err) {
    console.warn('[shell-path] ログインシェルからの PATH 取得に失敗しました:', err);
    log(`ログインシェルの実行に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

/** 1回分の解決を実行し、成功したら process.env.PATH に反映する。 */
async function attemptOnce(label: string): Promise<void> {
  const shell = process.env.SHELL || '/bin/zsh';
  retryState.lastAttemptAt = Date.now();
  retryState.inFlight = true;
  log(`${label}: shell=${shell} 現在のPATH=${process.env.PATH ?? '(未設定)'}`);
  const startedAt = Date.now();
  try {
    const loginPath = await resolveLoginShellPath(shell);
    if (!loginPath) {
      log(`${label}: 失敗（${Date.now() - startedAt}ms）。PATH は現状のまま縮退します`);
      return;
    }
    process.env.PATH = mergePathEntries(process.env.PATH, loginPath);
    log(`${label}: 成功（${Date.now() - startedAt}ms）。PATH=${process.env.PATH}`);
  } finally {
    retryState.inFlight = false;
  }
}

/**
 * process.env.PATH にログインシェルの PATH をマージする。起動時に一度だけ呼ぶ。
 * 取得に失敗した場合は何もしない（現状の PATH のまま縮退し、アプリは落とさない）。
 */
export async function ensureLoginShellPath(): Promise<void> {
  if (process.platform !== 'darwin') return;
  log('--- 起動 ---', true);
  await attemptOnce('起動時解決');
}

/**
 * 「claude が PATH に見つからない」を検知した呼び出し側（agents/poller.ts）が呼ぶ。
 * 抑制条件（実行中でない・15秒以上空いた・5回以内）を満たすときだけ再解決する。
 * 成功すれば次のポーリング・次の PTY 起動から自然に直る。
 */
export function retryLoginShellPath(): void {
  if (process.platform !== 'darwin') return;
  if (!shouldAttemptRetry(retryState, Date.now())) return;
  retryState.attemptCount += 1;
  void attemptOnce(`再解決（${retryState.attemptCount}/${RETRY_MAX_ATTEMPTS}回目）`);
}
