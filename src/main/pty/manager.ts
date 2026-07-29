// PTY のライフサイクル管理（起動・入出力・リサイズ・終了）。
//
// 設計上の鉄則: PTY からの出力は一切加工しない。ANSI エスケープを自前で
// 解釈・整形せず、そのまま IpcEvent.ptyData で Renderer（xterm.js）に流す。

import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';

import { app, ipcMain } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron';
import { spawn as spawnPty } from 'node-pty';
import type { IPty } from 'node-pty';

import {
  IpcInvoke,
  IpcSend,
  IpcEvent,
  type SpawnPtyRequest,
  type SpawnPtyResult,
  type PtyDataEvent,
  type PtyExitEvent,
  type PtyInputRequest,
  type PtyResizeRequest,
  type PtyCwdResult,
  type AppConfig,
} from '@shared/ipc';
import { getConfig } from '../config';
import { markOwnedSession } from '../agents/poller';
import { readProcessCwd } from './cwd';
import {
  isTmuxAvailable,
  buildTmuxSessionName,
  wrapCommandWithTmux,
  type CommandSpec,
} from './tmux';

// ---------------------------------------------------------------------------
// コマンド組み立て（純粋関数。テストしやすいよう副作用を持たせない）
// ---------------------------------------------------------------------------

/** spawn プランの結果。tmux でラップする前の「素のコマンド」を表す。 */
export interface SpawnPlan extends CommandSpec {
  /**
   * claude セッションを一意に識別する ID。
   * 新規起動時は --session-id で自前採番した UUID、resume 時は --resume に渡した
   * 既存のセッション ID がそのまま入る（resume で新たに採番することはない）。
   * つまり「同じ claude セッションに対しては常に同じ値になる」キー。
   * tmux セッション名（buildTmuxSessionName）はこれを使って組み立てるため、
   * ここが安定していることで Cmd+W で閉じたタブに resume で戻れる
   * （tmux new-session -A が既存セッションに当たる）。
   * gemini には安定した ID が無いため常に undefined。
   */
  agentSessionId?: string;
}

/**
 * ログインシェルの起動コマンドを組み立てる。
 * 決定順: config.shell -> $SHELL -> /bin/zsh。ログインシェルとして起動するため `-l` を渡す。
 */
export function buildShellPlan(config: Pick<AppConfig, 'shell'>): SpawnPlan {
  const shell = config.shell || process.env.SHELL || '/bin/zsh';
  return { command: shell, args: ['-l'] };
}

/**
 * claude の起動コマンドを組み立てる。
 * resumeSessionId が無い場合は自前で UUID を採番し、`--session-id` として渡す
 * （サイドバー側が `claude agents --json` の結果と突き合わせるための ID）。
 *
 * resume の場合は新しい ID を採番しない（generateId を呼ばない）が、
 * agentSessionId には resume 先の既存 ID をそのまま入れて返す。
 * こうしないと tmux セッション名（buildTmuxSessionName(plan.agentSessionId ?? ptyId)）が
 * 毎回 fresh な ptyId 由来になってしまい、`tmux new-session -A` が既存セッションに
 * 当たらない ＝ Cmd+W で閉じたタブに二度と戻れない、という不具合になる（Issue #60）。
 */
export function buildClaudePlan(
  req: Pick<SpawnPtyRequest, 'resumeSessionId'>,
  generateId: () => string = randomUUID,
): SpawnPlan {
  if (req.resumeSessionId) {
    return {
      command: 'claude',
      args: ['--resume', req.resumeSessionId],
      agentSessionId: req.resumeSessionId,
    };
  }
  const agentSessionId = generateId();
  return { command: 'claude', args: ['--session-id', agentSessionId], agentSessionId };
}

/** gemini の起動コマンドを組み立てる。 */
export function buildGeminiPlan(req: Pick<SpawnPtyRequest, 'geminiResumeTarget'>): SpawnPlan {
  if (req.geminiResumeTarget) {
    return { command: 'gemini', args: ['--resume', req.geminiResumeTarget] };
  }
  return { command: 'gemini', args: [] };
}

/** kind に応じて起動プランを組み立てる（tmux ラップ前）。 */
export function buildSpawnPlan(
  req: SpawnPtyRequest,
  config: Pick<AppConfig, 'shell'>,
  generateId?: () => string,
): SpawnPlan {
  switch (req.kind) {
    case 'shell':
      return buildShellPlan(config);
    case 'claude':
      return buildClaudePlan(req, generateId);
    case 'gemini':
      return buildGeminiPlan(req);
    default: {
      // req.kind は SpawnPtyRequest['kind'] で網羅済みのはずだが、
      // 将来的な型追加や不正な値に備えて防御的に扱う。
      const unreachable: never = req.kind;
      throw new Error(`unknown pty kind: ${String(unreachable)}`);
    }
  }
}

/**
 * PTY に渡す環境変数を組み立てる。
 * - Electron が注入する ELECTRON_* 系は子プロセスの挙動を壊しうるため削除する。
 * - TERM / COLORTERM を設定し、色が正しく出るようにする。
 * - LANG が未設定なら日本語表示のため ja_JP.UTF-8 を補う。
 * - TERM_PROGRAM / TERM_PROGRAM_VERSION は起動元の値を上書きする（下記コメント参照）。
 *
 * @param appVersion PTY に渡す TERM_PROGRAM_VERSION の値。呼び出し側から
 *   `app.getVersion()` を渡す想定（このファイル自体を Electron に依存させず
 *   単体テストしやすくするため引数で受け取る）。
 */
export function buildPtyEnv(
  base: NodeJS.ProcessEnv,
  appVersion: string,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...base };
  for (const key of Object.keys(env)) {
    if (key.startsWith('ELECTRON_')) delete env[key];
  }
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  if (!env.LANG) env.LANG = 'ja_JP.UTF-8';

  // TERM_PROGRAM を上書きする理由（Issue #61）:
  // ターミナル（Apple Terminal / iTerm2 等）から `make dev` で起動すると、
  // 起動元の TERM_PROGRAM（例: Apple_Terminal）がそのまま子プロセスへ継承される。
  // macOS の /etc/zshrc は末尾で
  //   [ -f /etc/zshrc_$TERM_PROGRAM ] && . /etc/zshrc_$TERM_PROGRAM
  // を実行しており、TERM_PROGRAM=Apple_Terminal だと /etc/zshrc_Apple_Terminal が
  // 走る。これは Apple Terminal 用のセッション復元（shell_session_update）を
  // 起動するもので、何も復元していないのに「Restored session: ...」という
  // 嘘の行を1行目に出し、副作用として ~/.zsh_sessions にファイルが溜まり続ける。
  // このアプリは Apple Terminal でも iTerm2 でもないので、継承された値が何であれ
  // 子プロセスから見て「自分は ai-terminal 上で動いている」と正しく分かるように
  // 固定で上書きする。
  env.TERM_PROGRAM = 'ai-terminal';
  // TERM_PROGRAM_VERSION は TERM_PROGRAM とセットで初めて意味を持つ値。素通しすると
  // 「TERM_PROGRAM は ai-terminal なのにバージョンだけ Apple Terminal・iTerm2 の
  // もの」という不整合な組み合わせが残ってしまう。削除するのではなく ai-terminal
  // 自身のバージョンに置き換え、ペアとして整合させる。
  env.TERM_PROGRAM_VERSION = appVersion;

  return env;
}

// ---------------------------------------------------------------------------
// バリデーション（unknown で受けて絞り込む）
// ---------------------------------------------------------------------------

function isSpawnPtyRequest(value: unknown): value is SpawnPtyRequest {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.kind !== 'shell' && v.kind !== 'claude' && v.kind !== 'gemini') return false;
  if (typeof v.cols !== 'number' || typeof v.rows !== 'number') return false;
  if (v.cwd !== undefined && typeof v.cwd !== 'string') return false;
  if (v.resumeSessionId !== undefined && typeof v.resumeSessionId !== 'string') return false;
  if (v.geminiResumeTarget !== undefined && typeof v.geminiResumeTarget !== 'string') return false;
  return true;
}

function isPtyInputRequest(value: unknown): value is PtyInputRequest {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.ptyId === 'string' && typeof v.data === 'string';
}

function isPtyResizeRequest(value: unknown): value is PtyResizeRequest {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.ptyId === 'string' && typeof v.cols === 'number' && typeof v.rows === 'number';
}

// ---------------------------------------------------------------------------
// PTY の保持と後始末
// ---------------------------------------------------------------------------

interface PtyEntry {
  pty: IPty;
  /** onData / onExit の送信先。破棄済みなら送らない。 */
  sender: WebContents;
}

const entries = new Map<string, PtyEntry>();

/** kind === 'shell' 以外、かつ設定で有効、かつ tmux が使える場合のみラップする。 */
function maybeWrapWithTmux(
  req: SpawnPtyRequest,
  plan: SpawnPlan,
  config: Pick<AppConfig, 'useTmux'>,
  ptyId: string,
): { plan: SpawnPlan; wrappedInTmux: boolean } {
  if (req.kind === 'shell') return { plan, wrappedInTmux: false };
  if (!config.useTmux) return { plan, wrappedInTmux: false };
  if (!isTmuxAvailable()) return { plan, wrappedInTmux: false };

  const sessionName = buildTmuxSessionName(plan.agentSessionId ?? ptyId);
  const wrapped = wrapCommandWithTmux(sessionName, plan);
  return { plan: { ...wrapped, agentSessionId: plan.agentSessionId }, wrappedInTmux: true };
}

function disposeEntry(ptyId: string): void {
  entries.delete(ptyId);
}

/**
 * PTY 関連の IPC ハンドラを登録する。
 * 送信先の BrowserWindow は `event.sender`（WebContents）をそのまま使う。
 * registerPtyHandlers() は引数を取らないため、spawn 時に渡された event.sender を
 * PTY エントリと一緒に保持しておき、onData/onExit ではそれに送る。
 */
export function registerPtyHandlers(): void {
  ipcMain.handle(
    IpcInvoke.ptySpawn,
    (event: IpcMainInvokeEvent, rawReq: unknown): SpawnPtyResult => {
      if (!isSpawnPtyRequest(rawReq)) {
        throw new Error('不正な pty:spawn リクエストです');
      }
      const req = rawReq;
      const config = getConfig();
      const ptyId = randomUUID();

      const basePlan = buildSpawnPlan(req, config);
      const { plan, wrappedInTmux } = maybeWrapWithTmux(req, basePlan, config, ptyId);

      const cwd = req.cwd || homedir();
      const env = buildPtyEnv(process.env, app.getVersion());

      let proc: IPty;
      try {
        proc = spawnPty(plan.command, plan.args, {
          name: 'xterm-256color',
          cols: req.cols,
          rows: req.rows,
          cwd,
          env,
        });
      } catch (err) {
        // claude / gemini / tmux が PATH に無い場合などはここで例外を再送出し、
        // Renderer 側の Promise を reject させる（アプリ自体は落とさない）。
        console.error('[pty] spawn に失敗しました:', err);
        throw err instanceof Error ? err : new Error(String(err));
      }

      entries.set(ptyId, { pty: proc, sender: event.sender });

      // このアプリが起動した Claude セッションを一覧側に知らせる（AgentTask.ownedByApp に反映される）。
      // 新規起動（--session-id で採番）と resume（--resume に渡した既存 ID）の両方が対象。
      // buildClaudePlan が resume でも agentSessionId に対象 ID を入れて返すようになったため、
      // req.resumeSessionId へのフォールバックはもう不要（plan.agentSessionId だけで足りる）。
      if (req.kind === 'claude' && plan.agentSessionId) {
        markOwnedSession(plan.agentSessionId);
      }

      proc.onData((data: string) => {
        const entry = entries.get(ptyId);
        if (!entry || entry.sender.isDestroyed()) return;
        const payload: PtyDataEvent = { ptyId, data };
        entry.sender.send(IpcEvent.ptyData, payload);
      });

      proc.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
        const entry = entries.get(ptyId);
        disposeEntry(ptyId);
        if (entry && !entry.sender.isDestroyed()) {
          const payload: PtyExitEvent = { ptyId, exitCode, signal };
          entry.sender.send(IpcEvent.ptyExit, payload);
        }
      });

      return { ptyId, agentSessionId: plan.agentSessionId, wrappedInTmux };
    },
  );

  // シェルタブで `cd` した先を追跡するための問い合わせ。
  // 実プロセスに聞くので、`cd` だけでなく pushd やスクリプト経由の移動も拾える。
  // 取得できなければ cwd を付けずに返す（呼び出し側が直前の値を維持する）。
  ipcMain.handle(
    IpcInvoke.ptyCwd,
    async (_event: IpcMainInvokeEvent, rawPtyId: unknown): Promise<PtyCwdResult> => {
      if (typeof rawPtyId !== 'string') {
        throw new Error('不正な pty:cwd リクエストです');
      }
      const entry = entries.get(rawPtyId);
      if (!entry) return { ptyId: rawPtyId };
      const cwd = await readProcessCwd(entry.pty.pid);
      return { ptyId: rawPtyId, cwd };
    },
  );

  ipcMain.handle(IpcInvoke.ptyKill, (_event: IpcMainInvokeEvent, rawPtyId: unknown): void => {
    if (typeof rawPtyId !== 'string') {
      throw new Error('不正な pty:kill リクエストです');
    }
    const entry = entries.get(rawPtyId);
    if (!entry) return; // 既に終了している場合は何もしない
    try {
      entry.pty.kill();
    } catch (err) {
      console.error(`[pty] ${rawPtyId} の kill に失敗しました:`, err);
    }
    disposeEntry(rawPtyId);
  });

  // 高頻度なので invoke ではなく send。受け取ったら同期的に write するだけ。
  ipcMain.on(IpcSend.ptyInput, (_event: IpcMainEvent, rawReq: unknown): void => {
    if (!isPtyInputRequest(rawReq)) return;
    const entry = entries.get(rawReq.ptyId);
    if (!entry) return;
    entry.pty.write(rawReq.data);
  });

  ipcMain.on(IpcSend.ptyResize, (_event: IpcMainEvent, rawReq: unknown): void => {
    if (!isPtyResizeRequest(rawReq)) return;
    const { ptyId, cols, rows } = rawReq;
    if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols <= 0 || rows <= 0) return;
    const entry = entries.get(ptyId);
    if (!entry) return;
    try {
      entry.pty.resize(cols, rows);
    } catch (err) {
      console.error(`[pty] ${ptyId} の resize に失敗しました:`, err);
    }
  });
}

/**
 * アプリ終了時（before-quit）に管理中の全 PTY プロセスを後始末する。
 * 1つの kill で例外が出ても他の PTY の後始末は続ける。
 */
export function disposePtyAll(): void {
  for (const [ptyId, entry] of entries) {
    try {
      entry.pty.kill();
    } catch (err) {
      console.error(`[pty] ${ptyId} の終了処理に失敗しました:`, err);
    }
  }
  entries.clear();
}
