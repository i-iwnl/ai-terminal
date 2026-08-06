// タスク一覧の行が押せるか、押すと何が起きるかを決める純粋関数（#180 周12）。
//
// **なぜ切り出したか。** 判定そのものが不具合の本体だったため。
// 以前は「そのセッションを開いているタブがアプリ内にあるか」だけを見ていたが、
// **タブの構成はどこにも永続化していない**ので、アプリを再起動した瞬間に
// 走っているセッションが全部「一覧には出るが押せない行」になっていた。
//
// tmux でラップして起動したセッションは `aiterm-<agentSessionId>` として生き残り、
// `tmux new-session -A` で**新しいプロセスを作らずに**アタッチし直せる
// （生存判定は `src/main/pty/tmuxSessions.ts`、結果は `AgentTask.recoverable`）。

import type { AgentTask } from '@shared/ipc';

/** 行を押したときに起きること。 */
export type TaskRowAction =
  /** 押せない（このアプリが起動していない / 戻る先が無い）。 */
  | 'none'
  /** いま開いているタブ（のペイン）へ移動する。 */
  | 'focus'
  /** 生きている tmux セッションへアタッチするタブを開く。 */
  | 'recover';

/**
 * 行の押下で何が起きるかを決める。
 *
 * ⛔ **`ownedByApp` を条件にしないこと。** これは **Main のメモリ上の Set**
 * （`src/main/agents/poller.ts` の `ownedSessionIds`）で、**アプリを再起動すると空になる**。
 * ここを条件にすると、まさに直そうとしている場面（再起動して見失った）で
 * 一度も true にならず、**この関数が何も直さなくなる**。実機で踏んだ。
 *
 * ⭐ **`recoverable` のほうが強い証拠。** tmux セッション名 `aiterm-<id>` を付けるのは
 * このアプリだけ（`buildTmuxSessionName`）なので、**その名前で生きているという事実自体が
 * 「このアプリが起動した」を意味する**。しかもメモリではなく tmux が保持しているので
 * アプリの再起動をまたぐ。
 *
 * ⛔ **`recoverable` は肯定条件でしか採らない**（`undefined` は false 扱い）。
 * 取得に失敗したときに「押せる」側へ倒すと、押した先で**新しいプロセスが生える**。
 */
export function resolveTaskRowAction(
  task: Pick<AgentTask, 'ownedByApp' | 'recoverable'>,
  hasOpenTab: boolean,
): TaskRowAction {
  // タブが開いているのは、このアプリがそのセッションを開いているときだけ
  // （`findTabByAgentSessionId`）。したがって ownedByApp を重ねて見る必要は無い。
  if (hasOpenTab) return 'focus';
  return task.recoverable === true ? 'recover' : 'none';
}

/**
 * 押したときに何が起きるかを表す語。読み上げ名の末尾に足す。
 *
 * ⛔ 「回収」は内部語なので画面にも読み上げにも出さない。
 */
export function taskRowActionLabel(action: TaskRowAction): string | undefined {
  switch (action) {
    case 'focus':
      return '開いているタブへ移動';
    case 'recover':
      return 'タブに戻す';
    default:
      return undefined;
  }
}
