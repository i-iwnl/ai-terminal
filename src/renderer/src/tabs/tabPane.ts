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

import { flattenPaneTree, resolveActiveLeaf, type PaneLeaf, type PaneNode } from './paneTree';

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

/**
 * ptyId からタブを探す（PTY の終了イベント・cwd 追従の突き合わせに使う）。
 *
 * **`tabLeaf(t)`（アクティブな leaf 1枚だけ）ではなく、木の全 leaf を見る。**
 * PR 3 の時点では木が常に leaf 1枚だったため両者は等価だったが、PR 4 で分割が
 * 有効になると非アクティブな leaf の PTY も終了しうる（例: 2枚に分割したタブで、
 * フォーカスが無い側のシェルで `exit` と打つ）。アクティブな leaf だけを見ていると、
 * その終了イベントの相手先タブが見つからず `markExited` が静かに no-op になる。
 */
export function findTabByPtyId(tabs: TabState[], ptyId: string): TabState | undefined {
  return tabs.find((t) => flattenPaneTree(t.layout).some((leaf) => leaf.ptyId === ptyId));
}

/**
 * agentSessionId からタブを探す（タスク一覧・通知クリックからのタブ前面化の突き合わせに使う）。
 *
 * 上の `findTabByPtyId` と同じ理由で、木の全 leaf を見る（アクティブでない
 * ペインで claude / gemini が動いていても、そのタブ自体は前面化できる必要がある）。
 * **ただし、そのタブの中のどのペインをアクティブにするかまでは踏み込まない**
 * （design-review.md の U4 はタスク一覧・通知をペイン粒度にする話で、これは
 * PR 8 の担当。ここで直すのはタブが見つからず前面化ごと失敗する分だけ）。
 */
export function findTabByAgentSessionId(
  tabs: TabState[],
  agentSessionId: string,
): TabState | undefined {
  return tabs.find((t) => flattenPaneTree(t.layout).some((leaf) => leaf.agentSessionId === agentSessionId));
}
