// 実行中タスク一覧（Phase 3）。
// window.api.agents.onTasks の push 購読 + 初回の list() 呼び出しで一覧を表示する。
// 「今どれが自分を待っているか」が一目でわかることを最優先にする。
//
// Issue #20 B（PR 8: タスク行の再設計）:
// - 状態語は行の左（走査は左から右）。色相の違いは手がかりに数えない、という
//   原則に従い、色（ドット）・形（見出しの区切り）・語（状態ラベル）の3つが
//   独立に同じ情報を運ぶようにする。
// - グループ見出しで区切る。ソートだけでは境界が視覚以外に伝わらないため見出しは必須。
// - 「待たせている時間」はセッション起動からの通算（formatElapsed）ではなく、
//   あなたの番になった時刻（yourTurnSince）からの経過にする。

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentTask, AgentTasksEvent } from '@shared/ipc';
// 状態の意味・グループ分け・見出し文言の単一の正。表示・通知・Dock バッジが同じ判定を使う。
import {
  toTaskState,
  groupTasksForDisplay,
  formatGroupHeading,
  TASK_STATE_LABEL,
} from '@shared/agent-status';
import { basename, formatElapsed, formatWaitingSince } from '../lib/format';
import { resolveTaskRowAction, taskRowActionLabel } from './taskRow';
// タスク一覧の購読はここで直接 window.api.agents を呼ばず、共有ハブに委ねる
// （App.tsx の Cmd+J も同じスナップショットを見る必要があるため。lib/agentTasksStore.ts 参照）。
import { subscribeAgentTasks, recheckAgentTasks } from '../lib/agentTasksStore';

/**
 * 「claude が PATH に無い」を検知してから見出しを赤字で目立たせる長さ（Issue #20 I-3）。
 * 本番のポーリング既定（pollIntervalMs 3000ms）と同じ値にしてある
 * （＝「次の1周期ぶんは目立ち、そのあとは黙る」という直感と一致させるため）。
 */
const LOUD_DURATION_MS = 3_000;

export interface TaskListProps {
  /** ownedByApp なタスクをクリックしたときに、対応するタブへフォーカスする */
  onFocusTab: (agentSessionId: string) => void;
  /** そのタスクに対応するタブが存在するか（無ければクリック不可にする） */
  canFocus: (agentSessionId: string) => boolean;
  /** 空状態の「起動」ボタン用（Issue #20 I-3）。Cmd+Shift+C と同じ操作 */
  onLaunchClaude: () => void;
  /**
   * 一覧を「このアプリを起動したフォルダ」に絞り込んでいるか（`AppConfig.scopeAgentsToCwd`）。
   * **スコープ行の文言にしか使わない**（絞り込みそのものは Main の poller が行う）。
   * 既定は false = マシン全体で、その事実がこれまで画面のどこにも出ていなかった。
   */
  scopedToCwd: boolean;
}

export default function TaskList({
  onFocusTab,
  canFocus,
  onLaunchClaude,
  scopedToCwd,
}: TaskListProps) {
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [errorKind, setErrorKind] = useState<AgentTasksEvent['errorKind']>(undefined);
  const [now, setNow] = useState(() => Date.now());

  // Issue #20 I-3「claude が PATH に無い」: ポーリングは pollIntervalMs（既定3秒）ごとに
  // 同じ ENOENT を検知し続けるが、ユーザーへ伝える価値があるのは最初だけ。
  // 「一度出したら黙る」= 検知したら LOUD_DURATION_MS のあいだだけ見出しを
  // 赤字にし、そのあとは静かな表示に落とす。
  //
  // **意図的にポーリング周期（pollIntervalMs）そのものには連動させていない。**
  // 「次のポーリング結果が来るまで目立たせる」という素朴な実装だと、初回検知の
  // 直後に（cwd 解決前後の初回フェッチと購読中の push が競合するなどで）
  // ほぼ同時に2件目の結果が届いた場合、React のバッチングにより「目立つ」
  // 状態が1度も画面に描画されないまま静かな状態へ上書きされてしまう
  // （実測でこの事故を作り込んだ）。固定時間のタイマーにすることで、
  // 何回どんな順序で結果が届いても「検知してから最低 LOUD_DURATION_MS は
  // 必ず目立つ」ことを保証する。
  const notFoundActiveRef = useRef(false);
  const quietTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [notFoundLoud, setNotFoundLoud] = useState(false);

  const clearQuietTimer = useCallback((): void => {
    if (quietTimerRef.current !== null) {
      clearTimeout(quietTimerRef.current);
      quietTimerRef.current = null;
    }
  }, []);

  const applyEvent = useCallback(
    (e: AgentTasksEvent, opts?: { manualRecheck?: boolean }): void => {
      setTasks(e.tasks);
      setError(e.error);
      setErrorKind(e.errorKind);

      if (e.errorKind !== 'not-found') {
        // 解消した（または別種のエラーになった）ので、次に not-found が来たら
        // また「初回」として扱えるようにリセットする。
        clearQuietTimer();
        notFoundActiveRef.current = false;
        setNotFoundLoud(false);
        return;
      }

      // 「再確認」ボタン経由は、ユーザーの問いへの直接の応答なので必ず
      // 目立たせ直す（タイマーもやり直す）。それ以外（自動ポーリングでの
      // 再検知）は、既にタイマーが動いている間は何もしない。
      if (!opts?.manualRecheck && notFoundActiveRef.current) return;

      clearQuietTimer();
      notFoundActiveRef.current = true;
      setNotFoundLoud(true);
      quietTimerRef.current = setTimeout(() => {
        quietTimerRef.current = null;
        setNotFoundLoud(false);
      }, LOUD_DURATION_MS);
    },
    [clearQuietTimer],
  );

  // 「再確認」ボタンから呼ぶ手動チェック。共有ハブ（agentTasksStore）に取り直しを
  // 依頼するだけで、window.api.agents は直接叩かない。結果は必ず目立たせたいので、
  // 「次に届く1件は手動再確認由来である」ことを ref に立てておき、購読側の
  // コールバックで読む（結果は onTasks の push と同じ経路で届くため、ここでは
  // Promise を直接 await しない）。
  const manualRecheckPendingRef = useRef(false);
  const recheck = useCallback((): void => {
    manualRecheckPendingRef.current = true;
    recheckAgentTasks();
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeAgentTasks((e: AgentTasksEvent) => {
      applyEvent(e, { manualRecheck: manualRecheckPendingRef.current });
      manualRecheckPendingRef.current = false;
    });

    return () => {
      unsubscribe();
      // アンマウント後に setTimeout のコールバックが setState を呼ばないようにする。
      clearQuietTimer();
    };
  }, [applyEvent, clearQuietTimer]);

  // 経過時間の表示を更新するためだけの軽い再描画トリガー（10秒間隔で十分）。
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  // 表示順（グループ単位）の唯一の正は groupTasksForDisplay（src/shared/agent-status.ts）。
  // 「あなたの番」を先頭に固定し、未知の状態は3つ目のグループとして末尾に置く
  // （「あなたの番」に混ぜない。CLI が新しい status 値を返し始めても誤って人間を急かさないため）。
  const groups = groupTasksForDisplay(tasks);

  const renderTask = (task: AgentTask) => {
    // 押せるか / 押すと何が起きるかの唯一の正は resolveTaskRowAction（taskRow.ts）。
    // ⛔ ここで ownedByApp を重ねて見ないこと（Main のメモリで、再起動すると空になる）。
    // ⭐ ここに条件を書き足さないこと。判定そのものが不具合の本体だったので
    // 純粋関数へ出して単体で固定している。
    const action = resolveTaskRowAction(task, canFocus(task.sessionId));
    const clickable = action !== 'none';
    const state = toTaskState(task.status);
    const name = task.name ?? `セッション ${task.sessionId.slice(0, 8)}`;
    const stateLabel = TASK_STATE_LABEL[state];

    // 「あなたの番」で遷移時刻が分かっているときだけ「待たせている時間」を出す。
    // それ以外（作業中・不明、または遷移時刻が未観測）はセッション起動からの
    // 通算（formatElapsed）に縮退する。無い情報を「待たせている時間」として
    // 捏造しない（鉄則5）。
    const elapsed =
      state === 'your-turn' && task.yourTurnSince !== undefined
        ? formatWaitingSince(task.yourTurnSince, now)
        : task.startedAt !== undefined
          ? formatElapsed(task.startedAt, now)
          : undefined;

    // 視覚的な並び（状態ラベル / 名前 / このアプリ / ディレクトリ名 / 生の status / 経過時間）を
    // そのまま読み上げの文にする。ボタン化に伴い aria-label が子要素のテキストより
    // 優先されるため、押せる行が何のセッションで今どの状態かはここだけで完結させる。
    // 状態語を先頭にするのは、視覚的な行の先頭（状態語）と同じ順にするため。
    const ariaLabel = [
      stateLabel,
      name,
      task.ownedByApp ? 'このアプリが起動' : undefined,
      // 押したときに何が起きるかを、押せる行だけで言い分ける。
      // ⛔ 「回収」は内部語なので画面にも読み上げにも出さない。
      taskRowActionLabel(action),
      basename(task.cwd),
      // CLI が返した生の値も読み上げに残す（鉄則4/5: CLI が言ったことを隠さない）。
      task.status !== undefined ? `CLI の生の状態は ${task.status}` : undefined,
      elapsed !== undefined ? elapsed : undefined,
    ]
      .filter((part): part is string => part !== undefined && part !== '')
      .join('、');

    // 見た目は行全体で1つ（アイコン + 本文）。押せる行だけ <button> にし、
    // 押せない行は非対話の <div> のまま保つ（Tab で止まって何も起きない、を避ける）。
    //
    // 状態語（stateLabel）は本文の先頭に置く。走査は左から右なので、
    // 色（ドット）だけでなく語も行の先頭で伝わるようにする（Issue #20 B）。
    const bodyContent = (
      <>
        <span className="task-item__status-dot" aria-hidden="true" />
        <div className="task-item__body">
          <div className="task-item__name">
            <span className="task-item__state">{stateLabel}</span>
            <span>{name}</span>
            {task.ownedByApp && <span className="task-item__badge">このアプリ</span>}
          </div>
          <div className="task-item__meta">
            <span>{basename(task.cwd)}</span>
            {/* CLI が返した生の値も残す。翻訳で潰すと、CLI 側の仕様変更に
                気づく手がかりが画面から消える（鉄則4/5） */}
            {task.status !== undefined && (
              <span className="task-item__raw-status">{task.status}</span>
            )}
            {elapsed !== undefined && <span className="task-item__elapsed">{elapsed}</span>}
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
            {bodyContent}
          </button>
        ) : (
          <div className="task-item__row">{bodyContent}</div>
        )}
      </li>
    );
  };

  return (
    <div className="task-list">
      {/* Issue #20 I-2 / #119 周3: いまどの範囲を見ているかを常設する。
          **0件でも消さない**（空状態でスコープが見えることが一番重要）。
          既定（scopeAgentsToCwd: false）はマシン全体で、他アプリから起動した
          claude も混ざる。その事実がこれまで画面のどこにも出ていなかった。 */}
      <h2 className="panel-scope">
        {scopedToCwd ? 'このフォルダの Claude' : 'このマシン全体の Claude'}
      </h2>
      {errorKind === 'not-found' ? (
        // Issue #20 I-3: 「claude が PATH に無い」専用の空状態パネル。
        // 赤字の生エラー文一行ではなく、見出し + 手順 + 再確認ボタンにする。
        // notFoundLoud が false のとき（自動ポーリングでの2回目以降の再検知）は
        // panel-empty--loud を外し、静かな見た目のまま情報だけ残す。
        <div className={`panel-message panel-empty${notFoundLoud ? ' panel-empty--loud' : ''}`}>
          <h3 className="panel-empty__heading">Claude CLI が見つかりません</h3>
          <p className="panel-empty__body">
            <code>claude</code> コマンドが PATH 上に見つかりません。ターミナルで{' '}
            <code>which claude</code> を実行し、インストール済みか・PATH が通っているかを確認してください。
          </p>
          <button type="button" className="panel-empty__action" onClick={recheck}>
            再確認
          </button>
        </div>
      ) : error ? (
        <div className="panel-message panel-message--error">
          タスク一覧の取得に失敗しました: {error}
        </div>
      ) : (
        tasks.length === 0 && (
          <div className="panel-message panel-empty">
            <p className="panel-empty__body">動いている AI はまだありません</p>
            <p className="panel-empty__hint">Cmd+Shift+C で Claude を起動できます</p>
            <button type="button" className="panel-empty__action" onClick={onLaunchClaude}>
              Claude を起動
            </button>
          </div>
        )
      )}
      {groups.map((group) => (
        <div className="task-group" key={group.state}>
          <h3 className="task-group__heading">
            {formatGroupHeading(group.state, group.tasks.length)}
          </h3>
          <ul>{group.tasks.map((task) => renderTask(task))}</ul>
        </div>
      ))}
    </div>
  );
}
