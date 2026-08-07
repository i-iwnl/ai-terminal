// 完了通知（「Claude の作業が完了しました」）を出すべきタスクの選択。
//
// poller.ts の detectAndNotifyCompletions に埋め込まれていた判定を、
// 入力から出力が閉じた純粋関数として切り出したもの。
//
// **切り出す前は、この判定を実行するテストが1本も無かった。** 単体テストは Electron の
// `app` / `Notification` に依存する poller.ts を読めず、固定 E2E フィクスチャは状態遷移を
// 一度も起こさない。その結果、**一覧が1ミリも変わっていないのに毎ポーリング通知が出る**
// 不具合（Issue #241）を素通しした。yourTurnSince.ts を切り出したのと同じ理由・同じ形。

import { becameYourTurn } from '@shared/agent-status';

import { indexByIdentity, taskIdentity, type IdentifiableTask } from './taskIdentity';

/** この判定が必要とする最小限の形。`AgentTask` のうち突き合わせキーと status だけを見る。 */
export interface CompletionTask extends IdentifiableTask {
  status?: string;
}

/**
 * 前回・今回の一覧から、完了通知を出すべきタスクを選ぶ。
 *
 * - 一覧に残っているもの: busy -> 非busy へ遷移したものを選ぶ。返すのは**今回の**タスク。
 * - 一覧から消えたもの: 消える直前が busy だったものだけを選ぶ（プロセス終了）。
 *   返すのは**前回の**タスク（今回の一覧に居ないので、それしか手元に無い）。
 * - 初回ポーリング（`previousTasks === undefined`）では何も選ばない。**これは空配列と
 *   同じ扱いにするだけで、専用の分岐は置かない。** 「前回に居ないものは通知しない」
 *   という本体の規則がそのまま同じ結果を出すため、早期 return を足しても
 *   **出力が1つも変わらない**（＝そこを壊しても赤くならない、独立に検証できない分岐に
 *   なる）。実際に早期 return を置いてから外して測り、緑のままであることを確認した。
 *
 * **突き合わせは `sessionId` ではなく `taskIdentity()` で行う**（理由は taskIdentity.ts）。
 * busy -> idle で通知済みのセッションがその後一覧から消えても、そのときの status は
 * idle なので再度は選ばれない（1回の完了につき通知は1回だけ、という方針）。
 */
export function selectCompletedTasks<T extends CompletionTask>(
  previousTasks: readonly T[] | undefined,
  currentTasks: readonly T[],
): T[] {
  const before = previousTasks ?? [];
  const beforeByIdentity = indexByIdentity(before);
  const currentIdentities = new Set(currentTasks.map((task) => taskIdentity(task)));

  const completed: T[] = [];

  for (const task of currentTasks) {
    const previous = beforeByIdentity.get(taskIdentity(task));
    if (previous && becameYourTurn(previous.status, task.status)) {
      completed.push(task);
    }
  }

  for (const previous of before) {
    // 一覧から消えた（プロセスが終わった）ものは「作業中でなくなった」とみなす
    if (!currentIdentities.has(taskIdentity(previous)) && becameYourTurn(previous.status, undefined)) {
      completed.push(previous);
    }
  }

  return completed;
}
