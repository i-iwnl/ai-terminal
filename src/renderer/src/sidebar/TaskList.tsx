// 実行中タスク一覧（Phase 3）。
// window.api.agents.onTasks の push 購読 + 初回の list() 呼び出しで一覧を表示する。
// 「今どれが自分を待っているか」が一目でわかることを最優先にする。

import { useEffect, useState } from 'react';
import type { AgentTask, AgentTasksEvent } from '@shared/ipc';
// 状態の意味の単一の正。表示・通知・Dock バッジが同じ判定を使う。
import { toTaskState, TASK_STATE_LABEL } from '@shared/agent-status';
import { basename, formatElapsed } from '../lib/format';
import { getSharedCwd, subscribeSharedCwd } from '../lib/cwd';

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
          const name = task.name ?? `セッション ${task.sessionId.slice(0, 8)}`;
          const stateLabel = TASK_STATE_LABEL[state];
          const elapsed = task.startedAt !== undefined ? formatElapsed(task.startedAt, now) : undefined;

          // 視覚的な並び（名前 / このアプリ / ディレクトリ名 / 状態ラベル / 生の status / 経過時間）を
          // そのまま読み上げの文にする。ボタン化に伴い aria-label が子要素のテキストより
          // 優先されるため、押せる行が何のセッションで今どの状態かはここだけで完結させる。
          const ariaLabel = [
            name,
            task.ownedByApp ? 'このアプリが起動' : undefined,
            basename(task.cwd),
            stateLabel,
            // CLI が返した生の値も読み上げに残す（鉄則4/5: CLI が言ったことを隠さない）。
            task.status !== undefined ? `CLI の生の状態は ${task.status}` : undefined,
            elapsed !== undefined ? `経過 ${elapsed}` : undefined,
          ]
            .filter((part): part is string => part !== undefined && part !== '')
            .join('、');

          // 見た目は行全体で1つ（アイコン + 本文）。押せる行だけ <button> にし、
          // 押せない行は非対話の <div> のまま保つ（Tab で止まって何も起きない、を避ける）。
          const body = (
            <>
              <span className="task-item__status-dot" aria-hidden="true" />
              <div className="task-item__body">
                <div className="task-item__name">
                  <span>{name}</span>
                  {task.ownedByApp && <span className="task-item__badge">このアプリ</span>}
                </div>
                <div className="task-item__meta">
                  <span>{basename(task.cwd)}</span>
                  <span className="task-item__state">{stateLabel}</span>
                  {/* CLI が返した生の値も残す。翻訳で潰すと、CLI 側の仕様変更に
                      気づく手がかりが画面から消える（鉄則4/5） */}
                  {task.status !== undefined && (
                    <span className="task-item__raw-status">{task.status}</span>
                  )}
                  {elapsed !== undefined && <span>{elapsed}</span>}
                </div>
              </div>
            </>
          );

          return (
            <li
              key={task.sessionId}
              // 押せるかどうかは modifier クラスではなく要素の種類（button か div か）で
              // 表す。CSS もそちらを見ているので、クラスを残すと「どちらが正か」が
              // 2つになる。
              className={['task-item', `task-item--${state}`, task.ownedByApp ? 'task-item--owned' : '']
                .filter(Boolean)
                .join(' ')}
            >
              {clickable ? (
                <button
                  type="button"
                  className="task-item__row"
                  aria-label={ariaLabel}
                  onClick={() => onFocusTab(task.sessionId)}
                >
                  {body}
                </button>
              ) : (
                <div className="task-item__row">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
