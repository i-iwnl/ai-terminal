// PTY のライフサイクル管理（起動・入出力・リサイズ・終了）。
//
// 設計上の鉄則: PTY からの出力は一切加工しない。ANSI エスケープを自前で
// 解釈・整形せず、そのまま IpcEvent.ptyData で Renderer（xterm.js）に流す。

import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { basename } from 'node:path';

import { BrowserWindow, app, ipcMain } from 'electron';
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
  type KillPtyRequest,
  type PtyInputRequest,
  type PtyResizeRequest,
  type PtyCwdResult,
  type AppConfig,
} from '@shared/ipc';
import { shouldBounceOnExit } from '@shared/pty-exit';
import { getConfig } from '../config';
import { markOwnedSession } from '../agents/poller';
import { readProcessCwd } from './cwd';
import { geminiSupportsSessionId } from './geminiVersion';
import { mergeUserEnv } from './shellEnv';
import { loginShellEnv } from '../shell-path';
import {
  isTmuxAvailable,
  buildTmuxAttachCommand,
  buildTmuxSessionName,
  ensureTmuxUpdateEnvironment,
  killTmuxSession,
  wrapCommandWithTmux,
  type CommandSpec,
} from './tmux';

// ---------------------------------------------------------------------------
// コマンド組み立て（純粋関数。テストしやすいよう副作用を持たせない）
// ---------------------------------------------------------------------------

/** spawn プランの結果。tmux でラップする前の「素のコマンド」を表す。 */
export interface SpawnPlan extends CommandSpec {
  /**
   * その CLI セッションを一意に識別する ID。
   * 新規起動時は --session-id で自前採番した UUID、resume 時は既存のセッション ID が
   * そのまま入る（resume で新たに採番することはない）。
   * つまり「同じ CLI セッションに対しては常に同じ値になる」キー。
   * tmux セッション名（buildTmuxSessionName）はこれを使って組み立てるため、
   * ここが安定していることで Cmd+W で閉じたタブに resume で戻れる
   * （tmux new-session -A が既存セッションに当たる）。
   * 意味の全文は SpawnPtyResult.agentSessionId（src/shared/ipc.ts）が唯一の正。
   */
  agentSessionId?: string;
}

/**
 * 起動時に判定して渡す、CLI 側の対応状況。
 * **純粋関数（buildSpawnPlan / buildGeminiPlan）から副作用を追い出すためだけの器。**
 * 実測は geminiSupportsSessionId()（src/main/pty/geminiVersion.ts）が行う。
 */
export interface CliFeatures {
  /** gemini が `--session-id` を受け付けるか（Gemini CLI 0.53.0 以降）。 */
  geminiSessionId: boolean;
}

/**
 * ⛔ **既定は「対応していない」。** 渡し忘れたときに倒れる先を、
 * 「tmux セッション名が安定しない（従来どおり）」側にする。
 * 逆に倒すと、古い CLI で**新規タブが起動直後に死ぬ**（geminiVersion.ts 冒頭を参照）。
 */
const NO_CLI_FEATURES: CliFeatures = { geminiSessionId: false };

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

/**
 * gemini の起動コマンドを組み立てる。**claude と対称**（Issue #155）。
 *
 * 新規起動は自前で UUID を採番して `--session-id` に渡し、同じ値を agentSessionId に返す。
 * resume は履歴側の内部 UUID（geminiAgentSessionId）をそのまま agentSessionId に返す
 * （resume で採番し直さない。claude と同じ理由）。
 *
 * ⛔ **`--resume` に渡すのは常に index（geminiResumeTarget）。UUID を渡さない。**
 * 数字始まりの UUID は index として解釈され、別セッションを作ったうえで
 * 既存のセッションファイルを失う（2026-08-06 実測 / 2回再現）。
 *
 * ⚠ **`--session-id` は CLI が 0.53.0 以降のときだけ渡す**（features.geminiSessionId）。
 * それ未満に渡すと usage を出して即終了する = 開いた瞬間に死んだペインになる。
 * 渡せないときは agentSessionId も返さない（tmux 名は ptyId 由来 = 従来どおりの縮退）。
 */
export function buildGeminiPlan(
  req: Pick<SpawnPtyRequest, 'geminiResumeTarget' | 'geminiAgentSessionId'>,
  generateId: () => string = randomUUID,
  features: CliFeatures = NO_CLI_FEATURES,
): SpawnPlan {
  if (req.geminiResumeTarget) {
    return {
      command: 'gemini',
      args: ['--resume', req.geminiResumeTarget],
      agentSessionId: req.geminiAgentSessionId,
    };
  }
  if (!features.geminiSessionId) {
    return { command: 'gemini', args: [] };
  }
  const agentSessionId = generateId();
  return { command: 'gemini', args: ['--session-id', agentSessionId], agentSessionId };
}

/**
 * 生きている tmux セッションへアタッチするだけのプラン。
 *
 * CLI の起動コマンドを1つも組み立てない（走っているものに繋ぐだけ）。
 * `agentSessionId` はそのまま返すので、閉じたあとの分類（`closeTabCopy.ts`）も
 * 新規起動・resume と同じ扱いになる。
 */
export function buildAttachPlan(agentSessionId: string): SpawnPlan {
  const wrapped = buildTmuxAttachCommand(buildTmuxSessionName(agentSessionId));
  return { ...wrapped, agentSessionId };
}

/** kind に応じて起動プランを組み立てる（tmux ラップ前）。 */
export function buildSpawnPlan(
  req: SpawnPtyRequest,
  config: Pick<AppConfig, 'shell'>,
  generateId?: () => string,
  features: CliFeatures = NO_CLI_FEATURES,
): SpawnPlan {
  switch (req.kind) {
    case 'shell':
      return buildShellPlan(config);
    case 'claude':
      return buildClaudePlan(req, generateId);
    case 'gemini':
      return buildGeminiPlan(req, generateId, features);
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
  if (v.geminiAgentSessionId !== undefined && typeof v.geminiAgentSessionId !== 'string')
    return false;
  if (v.attachAgentSessionId !== undefined && typeof v.attachAgentSessionId !== 'string')
    return false;
  return true;
}

function isKillPtyRequest(value: unknown): value is KillPtyRequest {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.ptyId !== 'string') return false;
  // 省略可。付いていれば boolean であること（文字列 'false' などを真と読まないため）。
  return v.terminateSession === undefined || typeof v.terminateSession === 'boolean';
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

/**
 * ptyId -> その PTY がぶら下がっている tmux セッション名（Issue #244）。
 *
 * ⭐ **Main がこれを持つのが唯一の正。** 持たせる前は `agentSessionId` / `wrappedInTmux` を
 * Renderer の `PaneLeaf` だけが持っており、**Main 単独では ptyId から tmux セッション名を
 * 引けなかった**。
 *
 * ⭐⭐ **`entries` とは別の Map にしてある。理由は寿命が違うから。**
 * `entries` は PTY が終了した時点で `disposeEntry()` が消すが、**tmux セッションは
 * そのあとも生き残りうる**（利用者がペインの中で `Ctrl-b d` を押して tmux クライアントだけを
 * デタッチした場合など）。同じ Map に入れておくと、その状態でタブを閉じたときに
 * `entries.get()` が `undefined` を返して**セッションが永久に残る** =
 * この Issue が直そうとしている累積そのものが再発する（code-review 2026-08-09 で指摘）。
 *
 * 消えるのは「利用者がそのペインを閉じたとき」（`ptyKill`）と、アプリ終了時
 * （`disposePtyAll`。⛔ **そこでは tmux を終了させず、対応表を捨てるだけ**）。
 *
 * ⛔ **Renderer に `aiterm-` を組み立てさせて渡す形にしないこと。** 接頭辞を扱う正は
 * `buildTmuxSessionName`（付ける）と `tmuxSessions.ts` の `SESSION_NAME_PREFIX`（剥がす）の
 * 2箇所だけで、3箇所目を作ると `tmux.ts` 冒頭が「唯一の正」と宣言している説明が
 * また片方だけ腐る（同ファイルに「実際に一度そうなった」とある）。
 *
 * ⛔ **`entry.pty.pid` から引き直す案は採らない。** あれは **tmux クライアントの pid** で、
 * ペイン内の claude / gemini の pid ではないので `listLiveAgentSessions()` の
 * `pane_pid` とは一致しない。
 */
const tmuxSessionNames = new Map<string, string>();

/**
 * 同じ tmux セッションに、**ほかの PTY もぶら下がっているか**（Issue #244）。
 *
 * ⭐ **1つの tmux セッションに複数のクライアントが繋がりうる。**
 * `wrapCommandWithTmux` が使う `new-session -A` は「同名があればアタッチ」なので、
 * 走っている claude セッションを履歴から resume すると、**同じ `aiterm-<id>` に
 * 2枚目のタブが繋がる**（`tmux.ts` 冒頭がその設計を「唯一の正」として書いている）。
 *
 * その状態で片方のタブを閉じたときにセッションごと終了させると、
 * **利用者が閉じていないほうのタブの AI まで巻き添えで死ぬ**（code-review 2026-08-09 で指摘）。
 * 残っているクライアントがあるなら、閉じる側は**デタッチするだけ**にする。
 */
function isTmuxSessionSharedWithOtherPty(ptyId: string, sessionName: string): boolean {
  for (const otherPtyId of entries.keys()) {
    if (otherPtyId === ptyId) continue;
    if (tmuxSessionNames.get(otherPtyId) === sessionName) return true;
  }
  return false;
}

/**
 * kind === 'shell' 以外、かつ設定で有効、かつ tmux が使える場合のみラップする。
 *
 * `env` は node-pty へ渡すものと**同じ値**を渡すこと。tmux は子プロセスへ env を
 * 引き継がないので、ラップするコマンド自体に載せないと1つも届かない
 * （理由の全文は src/main/pty/tmux.ts の wrapCommandWithTmux）。
 */
export function maybeWrapWithTmux(
  req: SpawnPtyRequest,
  plan: SpawnPlan,
  config: Pick<AppConfig, 'useTmux'>,
  ptyId: string,
  env: Record<string, string | undefined>,
  // tmux の有無だけが外部依存。既定で実測し、単体テストからは注入する
  // （テストが「そのマシンに tmux が入っているか」で結果を変えないようにする）。
  tmuxAvailable: boolean = isTmuxAvailable(),
): { plan: SpawnPlan; wrappedInTmux: boolean; tmuxSessionName?: string } {
  // ⛔ アタッチ計画は**既に tmux のコマンド**なので、重ねてラップしない
  // （`tmux new-session -A -s … -- tmux attach-session …` になってしまう）。
  //
  // ⭐ ただし**セッション名は返す**（Issue #244）。アタッチしたタブを閉じたときも
  // 中の AI を終了できなければ、「一覧から戻して、閉じたらまた残る」で累積が続く。
  // 名前の作り方は `buildAttachPlan` と同じ（`buildTmuxSessionName(agentSessionId)`）。
  if (req.attachAgentSessionId) {
    return {
      plan,
      wrappedInTmux: true,
      tmuxSessionName: buildTmuxSessionName(req.attachAgentSessionId),
    };
  }
  if (req.kind === 'shell') return { plan, wrappedInTmux: false };
  if (!config.useTmux) return { plan, wrappedInTmux: false };
  if (!tmuxAvailable) return { plan, wrappedInTmux: false };

  // ⛔ env は argv に載せない。tmux サーバへ「この名前はクライアントから引き継げ」と
  // 伝えるだけにする（値を argv に載せると ps から読める。tmux.ts のコメント参照）。
  ensureTmuxUpdateEnvironment(env);

  // ⚠ `agentSessionId` が無いときは `ptyId` に落ちる。**この場合も名前は確定している**
  // ので終了できる（Issue #244。`closeTabCopy.ts` の `persistentOrphaned` = 閉じたら
  // 二度と拾えないペインが、これで「閉じたら確実に終わる」に変わる）。
  const sessionName = buildTmuxSessionName(plan.agentSessionId ?? ptyId);
  const wrapped = wrapCommandWithTmux(sessionName, plan);
  return {
    plan: { ...wrapped, agentSessionId: plan.agentSessionId },
    wrappedInTmux: true,
    tmuxSessionName: sessionName,
  };
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

      // ⭐ **アタッチ要求は CLI の起動コマンドを組み立てない。**
      // 走っている tmux セッションへ繋ぐだけなので、`--session-id` も `--resume` も要らない
      // （むしろ渡すと、セッションが消えていたときに新規セッションを作ってしまう）。
      const attachId = req.attachAgentSessionId;
      const basePlan = attachId
        ? buildAttachPlan(attachId)
        : buildSpawnPlan(req, config, undefined, {
            geminiSessionId: geminiSupportsSessionId(),
          });
      // env は tmux ラップより先に組み立てる。tmux は子プロセスへ env を引き継がないので、
      // node-pty に渡すだけでは AI ペインに1つも届かない（tmux.ts の wrapCommandWithTmux）。
      //
      // GUI 起動の .app は ~/.zshrc の値を1つも持たないため、ログインシェルから
      // 取り直して重ねる（1度だけ・失敗したら現状維持。理由は shellEnv.ts）。
      const env = buildPtyEnv(
        mergeUserEnv(process.env, loginShellEnv()),
        app.getVersion(),
      );
      const { plan, wrappedInTmux, tmuxSessionName } = maybeWrapWithTmux(
        req,
        basePlan,
        config,
        ptyId,
        env,
      );

      const cwd = req.cwd || homedir();

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
      // ⭐ `entries` とは別に持つ。寿命が違う（上の `tmuxSessionNames` のコメントが唯一の正）。
      if (tmuxSessionName !== undefined) tmuxSessionNames.set(ptyId, tmuxSessionName);

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
        // **`entry` が無いのは、アプリ側が `pty:kill` で殺した場合**
        // （`ptyKill` のハンドラが先に `disposeEntry` する）。その終了は
        // ユーザーが起こしたものなので、Renderer へも通知せず Dock も鳴らさない。
        if (!entry || entry.sender.isDestroyed()) return;

        const payload: PtyExitEvent = { ptyId, exitCode, signal };
        entry.sender.send(IpcEvent.ptyExit, payload);

        // Issue #133: **異常終了をアプリの外へ出す。**
        //
        // ウィンドウ内には層が3枚ある（通知バナー / タブバーの終了表示 /
        // ペイン内の `[プロセスは終了しました…]`）が、**ウィンドウを見ていない
        // 時間帯には1つも届かない**。「14:00 に落ちて 15:30 に気づく」を縮めるには
        // 第0層（Dock）に出すしかない。
        //
        // 判定は `src/shared/pty-exit.ts` が唯一の正で、Renderer の
        // `severityForExit`（通知バナーの色）と**同じ関数**を見ている。
        // 条件は「異常終了 かつ ウィンドウが前に無い」（`poller.ts` の完了通知と同じ作法）。
        const win = BrowserWindow.fromWebContents(entry.sender);
        if (app.dock && shouldBounceOnExit({ exitCode, signal }, win?.isFocused() ?? false)) {
          app.dock.bounce('informational');
        }
      });

      // **`plan` ではなく `basePlan` から取る。** `plan` は tmux ラップ後なので
      // claude / gemini では `command` が `tmux` になる。`kind === 'shell'` は
      // 上の `maybeWrapWithTmux` が必ず素通しするので basePlan と一致するが、
      // 取り違えの余地を残さないよう明示的に basePlan を読む（Issue #137）。
      const shellName = req.kind === 'shell' ? basename(basePlan.command) : undefined;

      return { ptyId, agentSessionId: plan.agentSessionId, wrappedInTmux, shellName };
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

  /**
   * ⛔⛔ **このハンドラを `async` にしないこと。`await` を1つも挟まないこと**（Issue #244）。
   *
   * 現在 `entry.pty.kill()` -> `disposeEntry()` が**同一 tick** で走る。そのおかげで
   * `proc.onExit` が発火する頃には `entries.get(ptyId)` が `undefined` になっており、
   * 下の onExit ハンドラが「アプリ側が殺した終了」として **`ptyExit` の送信と
   * Dock バウンスを意図的に抑止している**（その分岐のコメントが唯一の正）。
   *
   * ここに `await` を1つ挟むと、`disposeEntry()` が次の tick へずれて
   * **タブを閉じるたびに「プロセスは終了しました」バナーが出て Dock が跳ねる**。
   * だから `killTmuxSession()` は投げっぱなし（非同期・待たない）で呼ぶ。
   */
  ipcMain.handle(IpcInvoke.ptyKill, (_event: IpcMainInvokeEvent, rawReq: unknown): void => {
    if (!isKillPtyRequest(rawReq)) {
      throw new Error('不正な pty:kill リクエストです');
    }
    const { ptyId, terminateSession } = rawReq;
    const entry = entries.get(ptyId);
    const sessionName = tmuxSessionNames.get(ptyId);

    // ⭐ tmux セッションの終了は **`disposeEntry()` の中に書かない**。
    // 「後始末」と「利用者の意図による終了」を同じ関数に混ぜると、あとから片方だけ
    // 変えたときに気づけない（`disposePtyAll` も `disposeEntry` を使いたくなる）。
    // 意図はここでだけ解釈する。
    //
    // ⭐⭐ **`entry` の有無より先に判定する。** PTY が既に終了していても
    // tmux セッションは生き残りうる（利用者が `Ctrl-b d` でデタッチした場合など）。
    // `if (!entry) return` を先に置くと、**その状態のタブを閉じたときにセッションが
    // 永久に残る** = この Issue が直そうとしている累積そのものが再発する。
    if (terminateSession === true && sessionName !== undefined) {
      if (isTmuxSessionSharedWithOtherPty(ptyId, sessionName)) {
        // 同じセッションを別のタブも開いている。閉じる側はデタッチするだけにする
        // （終了させると、利用者が閉じていないほうの AI まで巻き添えで死ぬ）。
        console.info(`[pty] ${sessionName} は他のペインも使用中のため終了させません`);
      } else {
        killTmuxSession(sessionName, mergeUserEnv(process.env, loginShellEnv()));
      }
    }
    tmuxSessionNames.delete(ptyId);

    if (!entry) return; // PTY 自体は既に終了している
    try {
      entry.pty.kill();
    } catch (err) {
      console.error(`[pty] ${ptyId} の kill に失敗しました:`, err);
    }
    disposeEntry(ptyId);
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
  // ⛔⛔ **ここで `killTmuxSession()` を呼ばないこと**（Issue #244）。
  // 「アプリを閉じても AI の作業が続く」はこのアプリの中核機能で、
  // `docs/PLAN.md` が挙げた tmux 永続化の動機そのもの。**対応表を捨てるだけ**にする。
  // この不変条件は E2E の S108 が守っている。
  tmuxSessionNames.clear();
}
