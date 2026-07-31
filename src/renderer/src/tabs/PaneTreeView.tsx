// タブ1枚分のペインの木（PaneNode）を、実際の DOM（.terminal-pane / .pane-split）に
// 再帰的に描画するコンポーネント。
//
// Issue #56 PR 4。木の操作そのものは tabs/paneTree.ts の純粋関数が全部持っているので、
// ここでは「木を JSX に変換する」ことだけを担当する。
//
// **role="tabpanel" は木のルートにだけ付く。** タブバーの role="tab" は
// aria-controls で1つの tabpanel を指す契約（ARIA 仕様）なので、分割で複数の
// leaf ができても id / role="tabpanel" / aria-labelledby は1箇所（isRoot な要素）
// にしか置かない。入れ子になった leaf・分割ノードは装飾目的の div/TerminalPane に
// とどめる（design-review.md の PR 4 スコープでは、ペイン個別の aria 名付けは
// 非目標。PR 5「aria 名」が担当）。
//
// **`ratio` の反映はインライン style（flex-grow）で行う。** 4px グリッドに乗る
// 離散値ではなく実行時に決まる連続値なので、styles.css のトークンにはしない
// （CLAUDE.md のトークン規約が対象にしているのは色・寸法の「デザイン値」であって、
// この比率のような算出値ではない）。固定比率 0.5 のみ（ドラッグでの変更は PR 7）。

import type { ReactElement } from 'react';
import type { PtyExitEvent, TerminalTheme } from '@shared/ipc';
import type { PaneNode } from './paneTree';
import { tabButtonId, tabPanelId } from './tabAriaIds';
import TerminalPane from '../terminal/TerminalPane';
import type { TerminalHandle } from '../terminal/useTerminal';

export interface PaneTreeViewProps {
  node: PaneNode;
  tabId: string;
  /** そのタブの中で今フォーカスされているべき leaf の paneId（TabState.activePaneId）。 */
  activePaneId: string;
  /** タブ自体が今表示されているか（タブ切り替えの可視性）。 */
  tabVisible: boolean;
  fontFamily: string;
  fontSize: number;
  theme: TerminalTheme;
  /** 設定 + 支援技術の自動検知を合成した「screenReaderMode を有効にしてよいか」。実際に渡すのはアクティブな1ペインだけ。 */
  screenReaderModeEnabled: boolean;
  onExit: (event: PtyExitEvent) => void;
  /** クリック等でこの paneId にフォーカスが入ったときに呼ぶ。 */
  onActivate: (paneId: string) => void;
  /** leaf ごとの TerminalHandle の登録・解除。App.tsx 側の handlesRef（paneId キー）に対応する。 */
  registerHandle: (paneId: string, handle: TerminalHandle | null) => void;
}

function renderNode(node: PaneNode, isRoot: boolean, props: PaneTreeViewProps): ReactElement {
  if (node.kind === 'leaf') {
    const active = props.tabVisible && node.paneId === props.activePaneId;
    return (
      <TerminalPane
        key={node.paneId}
        ref={(handle) => props.registerHandle(node.paneId, handle)}
        ptyId={node.ptyId}
        visible={props.tabVisible}
        active={active}
        panelId={isRoot ? tabPanelId(props.tabId) : undefined}
        labelledBy={isRoot ? tabButtonId(props.tabId) : undefined}
        fontFamily={props.fontFamily}
        fontSize={props.fontSize}
        theme={props.theme}
        // screenReaderMode はアクティブな1ペインだけ（S37 が固定する
        // 「露出している .xterm-accessibility は常に1個」を分割後も保つ。
        // App.tsx 側のコメント参照）。
        screenReaderMode={active && props.screenReaderModeEnabled}
        onExit={props.onExit}
        onActivate={() => props.onActivate(node.paneId)}
      />
    );
  }

  return (
    <div
      className={`pane-split pane-split--${node.dir}`}
      id={isRoot ? tabPanelId(props.tabId) : undefined}
      role={isRoot ? 'tabpanel' : undefined}
      aria-labelledby={isRoot ? tabButtonId(props.tabId) : undefined}
    >
      <div className="pane-split__cell" style={{ flex: `${node.ratio} 1 0%` }}>
        {renderNode(node.children[0], false, props)}
      </div>
      <div className="pane-split__cell" style={{ flex: `${1 - node.ratio} 1 0%` }}>
        {renderNode(node.children[1], false, props)}
      </div>
    </div>
  );
}

export default function PaneTreeView(props: PaneTreeViewProps): ReactElement {
  return renderNode(props.node, true, props);
}
