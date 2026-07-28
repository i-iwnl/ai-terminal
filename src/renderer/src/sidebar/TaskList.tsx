// 実行中タスク一覧（Phase 3）。
// window.api.agents.onTasks の push 購読 + 初回の list() 呼び出しで一覧を表示する。
// 「今どれが自分を待っているか」が一目でわかることを最優先にする。

import { useEffect, useState } from 'react';
import type { AgentTask, AgentTasksEvent } from '@shared/ipc';
import { basename, formatElapsed } from '../lib/format';
import { getSharedCwd, subscribeSharedCwd } from '../lib/cwd';

// CLI の語と、人間から見た意味は逆になりやすいので注意する。
//   busy = エージェントが動いている  -> 人間は待たなくてよい
//   idle = エージェントが止まっている -> 人間の入力待ち（あなたの番）
// 根拠は src/main/agents/poller.ts の遷移検知（busy -> 非busy を「作業完了」として通知している）。
//
// **未知の値を既知の2値に丸めない。** status は「CLI が返した値をそのまま持つ」ため
// （src/shared/ipc.ts）、二値分岐にすると CLI が新しい状態を返し始めた瞬間に全件が
// どちらか片側へ誤訳される。分からないものは分からないと表示する（鉄則5）。
type TaskState = 'working' | 'your-turn' | 'unknown';

function toTaskState(status: string | undefined): TaskState {
  if (status === 'busy') return 'working';
  if (status === 'idle') return 'your-turn';
  return 'unknown';
}

const TASK_STATE_LABEL: Record<TaskState, string> = {
  working: '作業中',
  'your-turn': 'あなたの番',
  unknown: '不明',
};

export interface TaskListProps {
  /** ownedByApp なタスクをクリックしたときに、対応するタブへフォーカスする */
  onFocusTab: (agentSessionId: string) => void;
  /** そのタスクに対応するタブが存在するか（無ければクリック不可にする） */
  canFocus: (agentSessionId: string) => boolean;
}

export default function TaskList({ onFocusTab, canFocus }: TaskListProps) {
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;

    // cwd を必ず添えて呼ぶ。**Main 側の絞り込み対象はこの引数からしか更新されない**ため、
    // 空で呼ぶと config.scopeAgentsToCwd を true にしても一切効かない（実際にそうなっていた）。
    const request = (): void => {
      window.api.agents
        .list({ cwd: getSharedCwd() })
        .then((e: AgentTasksEvent) => {
          if (cancelled) return;
          setTasks(e.tasks);
          setError(e.error);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : String(err));
        });
    };

    request();

    // cwd は起動直後に非同期で解決されるので、この時点ではまだ未解決のことがある。
    // 解決されたら伝え直す（解決済みなら購読は発火せず、上の request() が既に渡している）。
    const unsubscribeCwd = subscribeSharedCwd(() => {
      if (!cancelled) request();
    });

    const unsubscribe = window.api.agents.onTasks((e: AgentTasksEvent) => {
      if (cancelled) return;
      setTasks(e.tasks);
      setError(e.error);
    });

    return () => {
      cancelled = true;
      unsubscribeCwd();
      unsubscribe();
    };
  }, []);

  // 経過時間の表示を更新するためだけの軽い再描画トリガー（10秒間隔で十分）。
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="task-list">
      {error && (
        <div className="panel-message panel-message--error">
          タスク一覧の取得に失敗しました: {error}
        </div>
      )}
      {!error && tasks.length === 0 && (
        <div className="panel-message">実行中のタスクはありません</div>
      )}
      <ul>
        {tasks.map((task) => {
          const clickable = task.ownedByApp && canFocus(task.sessionId);
          const state = toTaskState(task.status);
          return (
            <li
              key={task.sessionId}
              className={[
                'task-item',
                `task-item--${state}`,
                task.ownedByApp ? 'task-item--owned' : '',
                clickable ? 'task-item--clickable' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={clickable ? () => onFocusTab(task.sessionId) : undefined}
            >
              <span className="task-item__status-dot" aria-hidden="true" />
              <div className="task-item__body">
                <div className="task-item__name">
                  <span>{task.name ?? `セッション ${task.sessionId.slice(0, 8)}`}</span>
                  {task.ownedByApp && <span className="task-item__badge">このアプリ</span>}
                </div>
                <div className="task-item__meta">
                  <span>{basename(task.cwd)}</span>
                  <span className="task-item__state">{TASK_STATE_LABEL[state]}</span>
                  {/* CLI が返した生の値も残す。翻訳で潰すと、CLI 側の仕様変更に
                      気づく手がかりが画面から消える（鉄則4/5） */}
                  {task.status !== undefined && (
                    <span className="task-item__raw-status">{task.status}</span>
                  )}
                  {task.startedAt !== undefined && <span>{formatElapsed(task.startedAt, now)}</span>}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
