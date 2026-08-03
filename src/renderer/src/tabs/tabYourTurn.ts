// 「あなたの番」の次/前のタブへジャンプする（Cmd+J、Shift で逆順。Issue #20 J）。
//
// 状態の意味の唯一の正は src/shared/agent-status.ts の toTaskState
// （busy = 作業中、busy 以外 = あなたの番）。ここではこの対応を反転させない。
//
// タブとタスクの突き合わせは、タブの木に含まれる**いずれかの** leaf の
// agentSessionId が task.sessionId と一致するかで行う（tabPane.ts の
// findTabByAgentSessionId と同じ考え方）。分割後、あなたの番のエージェントが
// 非アクティブなペインで動いていてもジャンプ対象に含める。

import { toTaskState } from '@shared/agent-status';
import type { YourTurnJumpDirection } from '@shared/ipc';
import { flattenPaneTree, type PaneNode } from './paneTree';

export type { YourTurnJumpDirection };

interface JumpableTab {
  id: string;
  layout: PaneNode;
}

interface JumpableTask {
  sessionId: string;
  status?: string;
}

/**
 * 現在アクティブなタブの次（backward なら前）から探索し、タブの並び順を環状と
 * みなして最初に見つかった「あなたの番」のタブの id を返す。
 *
 * 1周しても見つからなければ undefined を返す（タブが0枚、あなたの番のタスクが
 * 1件も無い、現在のタブしか候補が無い、のいずれか）。呼び出し側（App.tsx）は
 * undefined のとき「あなたの番のタブはありません」を通知する。**何も起きないまま
 * 終わらせない**（Issue #56 U4「画面が1pxも動かず壊れて見える」の再発防止）。
 *
 * 現在アクティブなタブ自身が「あなたの番」でも、探索は「次」から始まるため
 * そのタブへは戻らない（同じタブへジャンプしても手数の削減にならないため）。
 */
/**
 * 「あなたの番」のタスクが持つ sessionId の集合。
 *
 * 状態の意味の唯一の正は `src/shared/agent-status.ts` の `toTaskState`
 * （busy = 作業中、busy 以外 = あなたの番）。**ここで反転させない。**
 */
export function yourTurnSessionIds(tasks: readonly JumpableTask[]): Set<string> {
  return new Set(
    tasks.filter((task) => toTaskState(task.status) === 'your-turn').map((task) => task.sessionId),
  );
}

/**
 * そのタブが「あなたの番」を含むか（Issue #119 周5。タブバーの状態スロット用）。
 *
 * 判定は `findNextYourTurnTab` と同じで、木に含まれる**いずれかの** leaf の
 * `agentSessionId` が対象集合に入っていればよい。分割後、あなたの番の
 * エージェントが非アクティブなペインで動いていてもタブには印を出す
 * （タブは畳まれた木の代表なので、中のどれかが待っていれば待っている）。
 */
export function tabHasYourTurn(layout: PaneNode, sessionIds: ReadonlySet<string>): boolean {
  if (sessionIds.size === 0) return false;
  return flattenPaneTree(layout).some(
    (leaf) => leaf.agentSessionId !== undefined && sessionIds.has(leaf.agentSessionId),
  );
}

export function findNextYourTurnTab(
  tabs: readonly JumpableTab[],
  activeTabId: string | null,
  tasks: readonly JumpableTask[],
  direction: YourTurnJumpDirection,
): string | undefined {
  if (tabs.length === 0) return undefined;

  const sessionIds = yourTurnSessionIds(tasks);
  if (sessionIds.size === 0) return undefined;

  const isYourTurnTab = (tab: JumpableTab): boolean => tabHasYourTurn(tab.layout, sessionIds);

  const { length } = tabs;
  const startIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === activeTabId),
  );
  const step = direction === 'forward' ? 1 : -1;

  for (let i = 1; i <= length; i++) {
    const index = (((startIndex + step * i) % length) + length) % length;
    if (isYourTurnTab(tabs[index])) return tabs[index].id;
  }
  return undefined;
}
