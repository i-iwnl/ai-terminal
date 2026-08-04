// 「あなたの番」の次/前の**ペイン**へジャンプする（Cmd+J、Shift で逆順。Issue #20 J / #132）。
//
// 状態の意味の唯一の正は src/shared/agent-status.ts の toTaskState
// （busy = 作業中、busy 以外 = あなたの番）。ここではこの対応を反転させない。
//
// タブとタスクの突き合わせは leaf 単位で行う。**ジャンプの着地点もペイン**
// （Issue #132。タブだけ前に出しても、分割しているタブでは裏のペインに
// 居る claude に入力できない）。
//
// タブバーの状態ドット（`tabHasYourTurn`）は「そのタブのどれかが待っているか」
// という別の問いに答えるので、こちらは `some` で畳んだままでよい。
// **同じ木を見ていても、問いが違えば返す粒度も違う。**

import { toTaskState } from '@shared/agent-status';
import type { YourTurnJumpDirection } from '@shared/ipc';
import { flattenPaneTree, type PaneNode } from './paneTree';
import type { PaneLocation } from './tabPane';

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

/**
 * いまアクティブな**ペイン**の次（backward なら前）から探索し、
 * 全タブの全ペインを1本の環とみなして、最初に見つかった「あなたの番」の
 * ペインの位置（tabId + paneId）を返す。
 *
 * **タブではなくペインを返すのが要点**（Issue #132）。それまでは tabId しか
 * 返しておらず、呼び出し側は `setActiveTabId` しかできなかった。分割している
 * タブでは、**タブが前に出てもアクティブなペインは前のまま**なので、
 * 「あなたの番」の claude が裏のペインに居ると、`Cmd+J` で飛んだ先に
 * 入力できない（タブ止まり）。`tabHasYourTurn` が `some` で畳んでいたため、
 * **どの leaf が待っているかが呼び出し側に出てこなかった**のが原因。
 *
 * **ペインの環にすることで、タブが1枚しか無い場合も動くようになる。**
 * タブ単位の探索は `(startIndex + step * i) % length` を回すので、
 * `length === 1` のときは1周目で自分自身に戻り、`setActiveTabId` が no-op になる。
 * 「1タブを分割して片方が待っている」は分割の主用途そのものなのに、
 * そこで `Cmd+J` が何もしていなかった。
 *
 * 1周しても見つからなければ undefined を返す（ペインが0枚、あなたの番のタスクが
 * 1件も無い、いま見ているペインしか候補が無い、のいずれか）。呼び出し側（App.tsx）は
 * undefined のとき通知を出す。**何も起きないまま終わらせない**
 * （Issue #56 U4「画面が1pxも動かず壊れて見える」の再発防止）。
 *
 * いま見ているペイン自身が「あなたの番」でも、探索は「次」から始まるので
 * そこへは戻らない（同じ場所へジャンプしても手数の削減にならない）。
 */
export function findNextYourTurnPane(
  tabs: readonly JumpableTab[],
  activeTabId: string | null,
  activePaneId: string | null,
  tasks: readonly JumpableTask[],
  direction: YourTurnJumpDirection,
): PaneLocation | undefined {
  const sessionIds = yourTurnSessionIds(tasks);
  if (sessionIds.size === 0) return undefined;

  // タブの並び順 × 木の並び順（`flattenPaneTree` = 左上から）で1本に畳む。
  // **画面上の並びと探索順を一致させる**ため、木の順をそのまま使う。
  const panes = tabs.flatMap((tab) =>
    flattenPaneTree(tab.layout).map((leaf) => ({
      tabId: tab.id,
      paneId: leaf.paneId,
      agentSessionId: leaf.agentSessionId,
    })),
  );
  const { length } = panes;
  if (length === 0) return undefined;

  // いま見ているペインが見つからなければ「先頭の1つ前」から始める
  // （= forward なら先頭が最初の候補になる）。
  const startIndex = panes.findIndex(
    (pane) => pane.tabId === activeTabId && pane.paneId === activePaneId,
  );
  const from = startIndex === -1 ? (direction === 'forward' ? -1 : 0) : startIndex;
  const step = direction === 'forward' ? 1 : -1;

  for (let i = 1; i <= length; i++) {
    const index = (((from + step * i) % length) + length) % length;
    const pane = panes[index];
    // 1周して自分自身に戻ってきたら、他に候補が無いということ。
    if (index === startIndex) break;
    if (pane.agentSessionId !== undefined && sessionIds.has(pane.agentSessionId)) {
      return { tabId: pane.tabId, paneId: pane.paneId };
    }
  }
  return undefined;
}
