import { app, ipcMain, type BrowserWindow } from 'electron';
import { basename } from 'node:path';

import {
  IpcInvoke,
  IpcEvent,
  type AgentTask,
  type AgentTasksEvent,
  type ListAgentsRequest,
} from '@shared/ipc';
// 状態の意味の単一の正。表示（TaskList）と同じ判定を使う。
import { becameYourTurn, countYourTurn } from '@shared/agent-status';

import { getAppPaths } from '../app-paths';
import { getConfig } from '../config';
import { notify } from '../notify';
import { retryLoginShellPath } from '../shell-path';
import { listClaudeAgents } from './claude';

// エージェント（実行中タスク一覧）の取得とポーリング。
//
// - `claude agents --json` の出力形式に関する知識は claude.ts に閉じ込めてあるので、
//   このファイルは AgentTask[] だけを扱う。
// - ポーリングは「前回の取得が完了してから次を開始する」ことを保証するため、
//   setInterval ではなく完了後に次回をスケジュールする再帰的な setTimeout を使う。
//   これにより pollIntervalMs の設定変更もサイクルごとに反映される副次効果もある。

/** このアプリ自身が起動した（--session-id を指定した）セッションの ID 集合。 */
const ownedSessionIds = new Set<string>();

/**
 * PTY マネージャ側が --session-id で claude を起動したときに呼ぶ。
 * 呼び出しは別ワーカー（pty/）の担当なので、ここでは export を用意するだけ。
 */
export function markOwnedSession(sessionId: string): void {
  ownedSessionIds.add(sessionId);
}

/**
 * 絞り込み対象の cwd。Renderer が agents:list を呼ぶたびに更新される。
 *
 * 初期値はアプリを起動したディレクトリ。Renderer 側のアクティブ cwd
 * （src/renderer/src/lib/cwd.ts）も window.api.app.paths() 経由で同じ値を見ているので、
 * 出所は同じ。**ここを undefined から始めると、Renderer の最初の
 * agents:list が届くまでのポーリングだけ絞り込みが効かず、一覧が一瞬ちらつく。**
 *
 * `process.cwd()` をそのまま使わず getAppPaths() を通すのは、Finder 起動で `/` に
 * なる場合をホームへ倒すため（app-paths.ts の resolveLaunchCwd）。両者の出所が
 * 分かれると、Renderer が最初の agents:list を送るまでの間だけ別の値で絞り込むことになる。
 */
let lastKnownCwd: string | undefined = getAppPaths().cwd;

/** 直前のポーリング結果。busy -> idle の遷移検知に使う。初回ポーリング前は undefined。 */
let previousTasks: AgentTask[] | undefined;

/** ポーリング対象の BrowserWindow。破棄されていれば送信しない。 */
let targetWindow: BrowserWindow | null = null;

/** registerAgentHandlers の多重登録ガード。 */
let started = false;

/**
 * エージェントタスク一覧関連の IPC ハンドラを登録し、ポーリングを開始する。
 * @param win ポーリング結果を push する対象のウィンドウ。
 */
export function registerAgentHandlers(win: BrowserWindow): void {
  targetWindow = win;

  // 2回目以降の呼び出しではタイマー・ハンドラを再登録しない
  // （ipcMain.handle の二重登録はエラーになるため、多重タイマー防止も兼ねてここで防ぐ）。
  if (started) return;
  started = true;

  ipcMain.handle(
    IpcInvoke.agentsList,
    async (_event, req: ListAgentsRequest): Promise<AgentTasksEvent> => {
      updateLastKnownCwd(req);
      return fetchTasks();
    },
  );

  void runPollCycle();
}

/** Renderer から渡された cwd を、絞り込み用の最新値として覚えておく。 */
function updateLastKnownCwd(req: ListAgentsRequest | undefined): void {
  if (req && typeof req.cwd === 'string' && req.cwd.length > 0) {
    lastKnownCwd = req.cwd;
  }
}

/** 現在の設定・絞り込み状態に従って1回分の取得を行う。 */
async function fetchTasks(): Promise<AgentTasksEvent> {
  const config = getConfig();
  const cwd = config.scopeAgentsToCwd ? lastKnownCwd : undefined;

  const result = await listClaudeAgents(cwd);

  // claude が PATH に無い場合、起動時のログインシェル解決が一過性の要因
  // （起動直後の負荷等）で失敗したまま固定されている可能性がある。
  // 抑制付きで再解決を試みる（成功すれば次のポーリングから自然に直る）。
  if (result.errorKind === 'not-found') {
    retryLoginShellPath();
  }

  const tasks: AgentTask[] = result.tasks.map((task) => ({
    ...task,
    ownedByApp: ownedSessionIds.has(task.sessionId),
  }));

  return { tasks, error: result.error, fetchedAt: Date.now() };
}

/** 1回分のポーリングサイクル。完了後、必ず次回をスケジュールする。 */
async function runPollCycle(): Promise<void> {
  try {
    const event = await fetchTasks();

    // 取得エラー時は「一覧が全部消えた」ように見えてしまい誤通知になりうるため、
    // 完了通知の判定はスキップする（previousTasks も更新しない = 次に成功したときに正しく比較できる）。
    if (!event.error) {
      detectAndNotifyCompletions(event.tasks);
      updateDockBadge(event.tasks);
    }

    sendToRenderer(event);
  } catch (err) {
    // fetchTasks / listClaudeAgents は例外を投げない設計だが、念のための最終防衛ライン。
    sendToRenderer({
      tasks: [],
      error: err instanceof Error ? err.message : '不明なエラーでタスク一覧の取得に失敗しました',
      fetchedAt: Date.now(),
    });
  } finally {
    const intervalMs = getConfig().pollIntervalMs;
    setTimeout(() => {
      void runPollCycle();
    }, intervalMs);
  }
}

function sendToRenderer(event: AgentTasksEvent): void {
  if (!targetWindow || targetWindow.isDestroyed()) return;
  targetWindow.webContents.send(IpcEvent.agentTasks, event);
}

/**
 * Dock バッジに「あなたの番」の件数を出す。
 *
 * **クロームのピクセルを1つも使わずに伝えられる唯一の面。** ウィンドウ内の表現は
 * すべて「アプリを見ている」ことが前提だが、実利用ではエディタやブラウザを
 * 見ている時間のほうが長い。
 *
 * `notifyOnIdle`（通知の有無）とは独立させる。通知を切った人がバッジも失うと、
 * 「静かに使いたいが件数は知りたい」ができなくなる。
 */
function updateDockBadge(tasks: AgentTask[]): void {
  if (typeof app.setBadgeCount !== 'function') return;
  app.setBadgeCount(countYourTurn(tasks));
}

/**
 * 通知をクリックしたときに、そのセッションのタブを前に出す。
 *
 * ここが無いと「通知が来た -> アプリを探す -> タブバーを目で舐める ->
 * サイドバーを開く -> 行をクリック」を毎回踏むことになる。
 */
function focusSession(agentSessionId: string): void {
  if (!targetWindow || targetWindow.isDestroyed()) return;
  if (targetWindow.isMinimized()) targetWindow.restore();
  targetWindow.show();
  targetWindow.focus();
  targetWindow.webContents.send(IpcEvent.focusSession, agentSessionId);
}

/**
 * 前回と今回の一覧を比較し、busy から busy 以外へ遷移したセッションを通知する。
 *
 * 「一覧から消えた（プロセス終了）」セッションについては、消える直前が busy だった
 * ものだけを完了扱いにする。busy -> idle の遷移で既に通知済みのセッションが
 * その後一覧から消えても、その時点の status は idle なので再度は通知されない
 * （= 1回の完了につき通知は1回だけにする方針）。
 */
function detectAndNotifyCompletions(current: AgentTask[]): void {
  const config = getConfig();

  if (previousTasks === undefined) {
    // 初回ポーリングは比較対象が無いので、起動直後の大量通知を避けるためスキップする。
    previousTasks = current;
    return;
  }

  if (!config.notifyOnIdle) {
    previousTasks = current;
    return;
  }

  const prevById = new Map(previousTasks.map((task) => [task.sessionId, task]));
  const currentIds = new Set(current.map((task) => task.sessionId));

  for (const task of current) {
    const prev = prevById.get(task.sessionId);
    if (prev && becameYourTurn(prev.status, task.status)) {
      notifyCompletion(task);
    }
  }

  for (const prev of previousTasks) {
    // 一覧から消えた（プロセスが終わった）ものは「作業中でなくなった」とみなす
    if (!currentIds.has(prev.sessionId) && becameYourTurn(prev.status, undefined)) {
      notifyCompletion(prev);
    }
  }

  previousTasks = current;
}

function notifyCompletion(task: AgentTask): void {
  const label =
    task.name ?? (task.cwd ? basename(task.cwd) : undefined) ?? task.sessionId.slice(0, 8);
  notify(
    {
      title: 'Claude の作業が完了しました',
      body: label,
    },
    { onClick: () => focusSession(task.sessionId) },
  );

  // ウィンドウが前に無いときだけ Dock を弾ませる。
  // 見ている最中に弾ませても意味が無く、うるさいだけ。
  if (app.dock && targetWindow && !targetWindow.isFocused()) {
    app.dock.bounce('informational');
  }
}
