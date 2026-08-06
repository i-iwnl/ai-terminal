// 実行中タスク一覧（`claude agents --json` 由来）の購読ハブ。
//
// window.api.agents.list / onTasks を実際に呼ぶのはここ1箇所だけにする。
// サイドバーの表示（sidebar/TaskList.tsx）と、Cmd+J（次の「あなたの番」の
// タブへジャンプ。App.tsx の runAction）の両方がタスク一覧のスナップショットを
// 必要とする。片方だけが購読し、もう片方が独自に window.api.agents.list を
// 呼び直す実装にすると、取得タイミングがずれて「一覧の表示」と「Cmd+J が見ている
// 状態」が一瞬食い違いうる（購読を1つに保つのが唯一安全な設計）。
//
// terminal/ptyStream.ts・lib/cwd.ts と同じ、モジュール単位のシングルトン購読ハブ
// という設計に揃えてある（React の外側で状態を持ち、購読者は useEffect から
// subscribe する）。

import type { AgentTasksEvent } from '@shared/ipc';
import { getSharedCwd, subscribeSharedCwd } from './cwd';

type Listener = (e: AgentTasksEvent) => void;

const EMPTY_SNAPSHOT: AgentTasksEvent = { tasks: [], fetchedAt: 0 };

let snapshot: AgentTasksEvent = EMPTY_SNAPSHOT;
let started = false;
const listeners = new Set<Listener>();

function setSnapshot(e: AgentTasksEvent): void {
  snapshot = e;
  for (const listener of listeners) listener(e);
}

// cwd を必ず添えて呼ぶ。Main 側の絞り込み対象はこの引数からしか更新されない
// ため、空で呼ぶと config.scopeAgentsToCwd を true にしても一切効かない
// （TaskList.tsx の旧実装から踏襲した注意点）。
function request(): void {
  window.api.agents
    .list({ cwd: getSharedCwd() })
    .then((e) => setSnapshot(e))
    .catch((err: unknown) => {
      // 取得そのものに失敗しても、直前のタスク一覧は残したまま error だけを
      // 差し替える（鉄則5: 縮退表示。取得できていた情報を無かったことにしない）。
      setSnapshot({
        tasks: snapshot.tasks,
        liveSessions: snapshot.liveSessions,
        error: err instanceof Error ? err.message : String(err),
        fetchedAt: Date.now(),
      });
    });
}

function start(): void {
  if (started) return;
  started = true;
  request();
  // cwd は起動直後に非同期で解決されるので、この時点ではまだ未解決のことがある。
  // 解決・変化のたびに取り直す。
  subscribeSharedCwd(() => request());
  window.api.agents.onTasks((e) => setSnapshot(e));
}

/**
 * 現在のスナップショットを購読する。購読開始時に現在値を即座に1回通知し
 * （購読前から既に他の購読者がいれば、待たずに最新値が届く）、以降は変化のたびに
 * 通知する。戻り値は購読解除関数。
 */
export function subscribeAgentTasks(listener: Listener): () => void {
  start();
  listener(snapshot);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 「再確認」ボタン（Issue #20 I-3）用。必ず新しい結果でスナップショットを更新し直す。 */
export function recheckAgentTasks(): void {
  start();
  request();
}
