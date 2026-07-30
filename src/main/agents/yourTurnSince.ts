// 「あなたの番になった時刻」の記録更新。busy -> 非busy の遷移を検知して
// Date.now() を記録するだけの処理だが、poller.ts に埋め込んだままでは
// どのテストからも実行されない（固定 E2E フィクスチャは遷移を一度も起こさない）。
//
// 入力から出力が閉じた純粋関数として切り出し、test/unit/ で固定する
// （CLAUDE.md 「テストの置き場は外部に触れるかで決める」）。
// 呼び出し側（poller.ts）はモジュールスコープの Map にこの結果を代入するだけにする。
//
// 並行トラック（Issue #56 PR 0-b）の src/renderer/src/terminal/resizeGate.ts と
// 同じ形（判定だけを持つ小さな純粋関数 + 型）に揃えてある。

import { becameYourTurn, toTaskState } from '@shared/agent-status';

/** この判定が必要とする最小限の形。AgentTask のうち sessionId と status だけを見る。 */
export interface YourTurnTask {
  sessionId: string;
  status?: string;
}

/**
 * 前回・今回の一覧から、「あなたの番になった時刻」の記録を更新する。
 *
 * - busy -> 非busy の遷移を検知したセッションには `nowMs` を記録する。
 * - 非busy -> busy（作業中に戻る）で記録を消す。次に「あなたの番」になったとき、
 *   古い遷移時刻を使い回してしまわないようにするため。
 * - **unknown への遷移では消さない。** 不明値を挟んだだけで、待たせ続けている
 *   可能性のほうが高いと判断する（意図的な設計判断。呼び出し側のコメント参照）。
 * - 初回ポーリング（`previousTasks === undefined`）は比較対象が無いので何もしない。
 *   起動時から既に「あなたの番」だったセッションは記録されないまま
 *   （= 縮退表示。無い情報を捏造しない）。
 * - 今回の一覧に存在しないセッションの記録は取り除く（メモリリーク防止）。
 *
 * `previousRecord` は書き換えない（新しい Map を返す）。`nowMs` は呼び出し側から
 * 受け取る（テストで時刻を固定するため。関数内で Date.now() を呼ばない）。
 */
export function computeYourTurnSince(
  previousRecord: ReadonlyMap<string, number>,
  previousTasks: readonly YourTurnTask[] | undefined,
  currentTasks: readonly YourTurnTask[],
  nowMs: number,
): Map<string, number> {
  const next = new Map(previousRecord);

  if (previousTasks !== undefined) {
    const prevById = new Map(previousTasks.map((task) => [task.sessionId, task]));

    for (const task of currentTasks) {
      const prev = prevById.get(task.sessionId);
      if (prev && becameYourTurn(prev.status, task.status)) {
        next.set(task.sessionId, nowMs);
      } else if (toTaskState(task.status) === 'working') {
        next.delete(task.sessionId);
      }
    }
  }

  const currentIds = new Set(currentTasks.map((task) => task.sessionId));
  for (const sessionId of next.keys()) {
    if (!currentIds.has(sessionId)) next.delete(sessionId);
  }

  return next;
}
