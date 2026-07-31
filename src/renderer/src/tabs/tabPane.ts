// タブ1枚の状態（TabState）と、その中から leaf を引く純粋関数。
//
// useTabs.ts は window.api（preload の型）に依存する他のコードを大量に抱えており、
// そのまま test/unit/ からインポートすると tsconfig.test.json（global.d.ts の
// window.api 拡張を含まない）で型エラーになる（tabTitle.ts のコメントと同じ理由）。
// TabState 型と、それだけを使う純粋関数はここへ切り出し、単体テストから
// 安全にインポートできるようにする。
//
// PTY のメタ（ptyId / kind / title / agentSessionId / cwd / exit）は
// TabState 自体ではなく、ペインの木の中の leaf（PaneLeaf）に持たせる
// （Issue #56 PR 3。設計の唯一の正は `.claude/workspace/issue-56/design-review.md`
// の Q4）。`TabState` に残るのは `id` / `layout` / `activePaneId` / `createdAt`
// だけ。PR 3 の時点では木は常に leaf 1枚（`splitPane` を呼ぶ経路がまだ無い）ので、
// `tabLeaf()` が返す値は実質そのタブの「PTY のメタ」そのものになる。

import { resolveActiveLeaf, type PaneLeaf, type PaneNode } from './paneTree';

export interface TabState {
  /** タブを一意に識別する ID。生成時点では leaf の paneId と同じ値（PTY の spawn 結果の ptyId）を使う。 */
  id: string;
  /** ペインの木。PR 3 の時点では常に leaf 1枚。 */
  layout: PaneNode;
  /** 木の中で「今表示している」leaf の paneId。 */
  activePaneId: string;
  createdAt: number;
}

/**
 * タブの中で今表示すべき leaf を返す。PTY のメタ（ptyId / kind / title /
 * agentSessionId / cwd / exit）はここから読む。
 *
 * 内部は `resolveActiveLeaf` そのもの（`activePaneId` が見つからない異常時は
 * 先頭の leaf にフォールバックする）。TabState と PaneNode を橋渡しするための
 * 薄いラッパー。
 */
export function tabLeaf(tab: TabState): PaneLeaf {
  return resolveActiveLeaf(tab.layout, tab.activePaneId);
}

/** ptyId からタブを探す（PTY の終了イベント・cwd 追従の突き合わせに使う）。 */
export function findTabByPtyId(tabs: TabState[], ptyId: string): TabState | undefined {
  return tabs.find((t) => tabLeaf(t).ptyId === ptyId);
}

/** agentSessionId からタブを探す（タスク一覧・通知クリックからのタブ前面化の突き合わせに使う）。 */
export function findTabByAgentSessionId(
  tabs: TabState[],
  agentSessionId: string,
): TabState | undefined {
  return tabs.find((t) => tabLeaf(t).agentSessionId === agentSessionId);
}
