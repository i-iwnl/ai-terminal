import { ipcMain, type BrowserWindow } from 'electron';
import { basename } from 'node:path';

import {
  IpcInvoke,
  IpcEvent,
  type AgentTask,
  type AgentTasksEvent,
  type ListAgentsRequest,
} from '@shared/ipc';

import { getConfig } from '../config';
import { notify } from '../notify';
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

/** Renderer から最後に渡された絞り込み対象の cwd。一度も渡されていなければ undefined。 */
let lastKnownCwd: string | undefined;

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
    if (prev && prev.status === 'busy' && task.status !== 'busy') {
      notifyCompletion(task);
    }
  }

  for (const prev of previousTasks) {
    if (!currentIds.has(prev.sessionId) && prev.status === 'busy') {
      notifyCompletion(prev);
    }
  }

  previousTasks = current;
}

function notifyCompletion(task: AgentTask): void {
  const label =
    task.name ?? (task.cwd ? basename(task.cwd) : undefined) ?? task.sessionId.slice(0, 8);
  notify({
    title: 'Claude の作業が完了しました',
    body: label,
  });
}
