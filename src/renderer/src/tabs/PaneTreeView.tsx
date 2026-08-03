// タブ1枚分のペインの木（PaneNode）を、実際の DOM（.terminal-pane / .pane-split）に
// 再帰的に描画するコンポーネント。
//
// Issue #56 PR 4。木の操作そのものは tabs/paneTree.ts の純粋関数が全部持っているので、
// ここでは「木を JSX に変換する」ことだけを担当する。
//
// **role="tabpanel" は木のルートにだけ付く。** タブバーの role="tab" は
// aria-controls で1つの tabpanel を指す契約（ARIA 仕様）なので、分割で複数の
// leaf ができても id / role="tabpanel" / aria-labelledby は1箇所（isRoot な要素）
// にしか置かない。入れ子になった leaf は role="group" + aria-label（下記）で
// 「このペインが何か」を説明する（PR 5「aria 名」。tabpanel を名乗らせない
// ことで PR 4 の1タブ=1tabpanel契約と衝突しない）。
//
// **`ratio` の反映はインライン style（flex-grow）で行う。** 4px グリッドに乗る
// 離散値ではなく実行時に決まる連続値なので、styles.css のトークンにはしない
// （CLAUDE.md のトークン規約が対象にしているのは色・寸法の「デザイン値」であって、
// この比率のような算出値ではない）。
//
// **スプリッタ（Issue #56 PR 7）はドラッグ中に flex-grow を書き換えない。**
// 2つの `.pane-split__cell` の間に `PaneSplitterHandle` を挟み、ドラッグ中は
// そちら側だけが `position: fixed` のゴースト線を動かす。`mouseup` で確定した
// ratio だけが `onRatioCommit` を通じて呼び出し側（useTabs.ts）へ届き、
// そこで初めて木の `ratio` が更新されて flex-grow が書き換わる（1回だけ）。
// `PaneSplitterHandle.tsx` の冒頭コメント参照。

import type { ReactElement } from 'react';
import type { PtyExitEvent, TerminalTheme } from '@shared/ipc';
import { flattenPaneTree, type PaneNode, type PanePath } from './paneTree';
import { paneHeaderLabel } from './paneHeader';
import PaneSplitterHandle from './PaneSplitterHandle';
import { pathKey, splitterAriaLabel, splitterValueText } from './paneSplitter';
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
  /**
   * 最大化表示の対象 leaf の paneId（Issue #56 PR 8・design-review.md 提案 I）。
   * 未設定（最大化していない）なら undefined。
   *
   * **木の `ratio` や構造には一切触れない。** 対象を含まない側の
   * `.pane-split__cell` を一時的に0幅へ畳み（`pane-split__cell--collapsed`）、
   * 対象を含む側を `flex: 1 1 100%` で埋めるだけの、レンダリング時だけの
   * 上書き。畳んだ側は PTY もマウントも維持したまま（visibility だけ
   * hidden）なので、最大化を解除すれば元の ratio のまま瞬時に戻る。
   */
  maximizedPaneId?: string;
  fontFamily: string;
  fontSize: number;
  theme: TerminalTheme;
  /** 設定 + 支援技術の自動検知を合成した「screenReaderMode を有効にしてよいか」。実際に渡すのはアクティブな1ペインだけ。 */
  screenReaderModeEnabled: boolean;
  onExit: (event: PtyExitEvent) => void;
  /** クリック等でこの paneId にフォーカスが入ったときに呼ぶ。スプリッタの閾値未満クリック（design-review.md 提案 D'）でも同じ経路を使う。 */
  onActivate: (paneId: string) => void;
  /** leaf ごとの TerminalHandle の登録・解除。App.tsx 側の handlesRef（paneId キー）に対応する。 */
  registerHandle: (paneId: string, handle: TerminalHandle | null) => void;
  /**
   * 分割ノードの `.pane-split` コンテナ DOM の登録・解除（Issue #56 PR 7）。
   * メニュー項目「分割比を広げる/狭める/50%に戻す」がドラッグを介さずに
   * コンテナの実寸を測るために使う（App.tsx 側の splitContainerRefs）。
   * キーは `paneSplitter.ts` の `pathKey()` で経路から作る。
   */
  registerSplitRef: (key: string, el: HTMLDivElement | null) => void;
  /**
   * スプリッタ本体（`.pane-splitter`）の DOM の登録・解除（Issue #56 PR 7・
   * レビュー指摘）。メニュー項目「分割比を広げる/狭める/50%に戻す」が、
   * 比率を動かした対象のスプリッタへ `.focus()` するために使う
   * （`tabIndex={-1}` なのでプログラム的にしか到達できない。
   * PaneSplitterHandle.tsx 冒頭コメント参照）。キーは `registerSplitRef` と
   * 同じ `pathKey()`。
   */
  registerSplitterRef: (key: string, el: HTMLDivElement | null) => void;
  /**
   * スプリッタのドラッグが `mouseup` で確定したときに、その分割ノードへの
   * 経路と確定した ratio（[0,1] の緩いクランプ済み）を渡す。実セル寸法ベースの
   * 最終クランプは呼び出し側（useTabs.ts の updateSplitRatio）が行う。
   */
  onRatioCommit: (path: PanePath, ratio: number) => void;
}

function renderNode(
  node: PaneNode,
  isRoot: boolean,
  path: PanePath,
  props: PaneTreeViewProps,
): ReactElement {
  if (node.kind === 'leaf') {
    const active = props.tabVisible && node.paneId === props.activePaneId;
    // **`props.node`（このタブの木の根）が split かどうかで決める。** node.kind
    // === 'split' なら、深さに関わらずタブ内の全 leaf にヘッダを出す
    // （design-review.md 提案 G「分割中のみ」。1ペインのタブでは根が leaf 自身に
    // なるため常に false）。
    const showHeader = props.node.kind === 'split';
    const label = paneHeaderLabel(node);
    return (
      <TerminalPane
        key={node.paneId}
        ref={(handle) => props.registerHandle(node.paneId, handle)}
        ptyId={node.ptyId}
        visible={props.tabVisible}
        active={active}
        panelId={isRoot ? tabPanelId(props.tabId) : undefined}
        labelledBy={isRoot ? tabButtonId(props.tabId) : undefined}
        label={label}
        wrappedInTmux={node.wrappedInTmux}
        showHeader={showHeader}
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

  // スプリッタの閾値未満クリック（design-review.md 提案 D'。ペインの端 8px の
  // デッドゾーン対策）は、押した側の部分木のうち先頭（左上）の leaf を
  // アクティブにする。既存の onActivate（leaf クリックと同じ経路）をそのまま
  // 使うので、App.tsx 側に新しい配線は要らない。
  const activateFirstOf = (side: 'first' | 'second'): void => {
    const target = side === 'first' ? node.children[0] : node.children[1];
    props.onActivate(flattenPaneTree(target)[0].paneId);
  };

  // **タブが非表示のとき、木のルートにだけ pane-split--hidden を付ける。**
  // leaf（.terminal-pane）は元から `visible` prop で個別に隠れる（root/入れ子を
  // 問わず全 leaf に同じ tabVisible を渡しているため）。だが Issue #56 PR 7 で
  // 追加したスプリッタ（.pane-splitter）自身は leaf ではないので、その隠れる
  // 仕組みに乗っていない。ルートを visibility: hidden にすれば、CSS の
  // visibility は子へ継承されるため、明示的に visibility: visible を
  // 上書きしていないスプリッタも一緒に隠れる（非表示タブの分割線が、切り替えた
  // 先のタブの上に描画されたまま残る事故を防ぐ）。
  const rootHiddenClass = isRoot && !props.tabVisible ? ' pane-split--hidden' : '';

  // 最大化（Issue #56 PR 8）: 対象 leaf がこのノードのどちら側の部分木に
  // 属するかを見て、含まない側を0幅へ畳む。木の `ratio` はここでは
  // 一切書き換えない（`node.ratio` を読むだけ）ので、最大化を解除すれば
  // 元の flex-grow がそのまま復活する。
  const maximizedPaneId = props.maximizedPaneId;
  const firstHasMaximized =
    maximizedPaneId !== undefined &&
    flattenPaneTree(node.children[0]).some((l) => l.paneId === maximizedPaneId);
  const secondHasMaximized =
    maximizedPaneId !== undefined &&
    flattenPaneTree(node.children[1]).some((l) => l.paneId === maximizedPaneId);
  const isMaximizing = firstHasMaximized || secondHasMaximized;

  const firstFlex = isMaximizing ? (firstHasMaximized ? '1 1 100%' : '0 0 0%') : `${node.ratio} 1 0%`;
  const secondFlex = isMaximizing
    ? (secondHasMaximized ? '1 1 100%' : '0 0 0%')
    : `${1 - node.ratio} 1 0%`;
  const firstCollapsed = isMaximizing && !firstHasMaximized;
  const secondCollapsed = isMaximizing && !secondHasMaximized;

  return (
    <div
      className={`pane-split pane-split--${node.dir}${rootHiddenClass}`}
      id={isRoot ? tabPanelId(props.tabId) : undefined}
      role={isRoot ? 'tabpanel' : undefined}
      aria-labelledby={isRoot ? tabButtonId(props.tabId) : undefined}
      ref={(el) => props.registerSplitRef(pathKey(path), el)}
    >
      <div
        className={`pane-split__cell${firstCollapsed ? ' pane-split__cell--collapsed' : ''}`}
        style={{ flex: firstFlex }}
      >
        {renderNode(node.children[0], false, [...path, 0], props)}
      </div>
      <PaneSplitterHandle
        dir={node.dir}
        ratio={node.ratio}
        ariaLabel={splitterAriaLabel(node.dir)}
        ariaValueText={splitterValueText(node.dir, node.ratio)}
        onCommitRatio={(ratio) => props.onRatioCommit(path, ratio)}
        onActivateSide={activateFirstOf}
        registerRef={(el) => props.registerSplitterRef(pathKey(path), el)}
        hidden={isMaximizing}
      />
      <div
        className={`pane-split__cell${secondCollapsed ? ' pane-split__cell--collapsed' : ''}`}
        style={{ flex: secondFlex }}
      >
        {renderNode(node.children[1], false, [...path, 1], props)}
      </div>
    </div>
  );
}

export default function PaneTreeView(props: PaneTreeViewProps): ReactElement {
  return renderNode(props.node, true, [], props);
}
