// タブ内ペイン分割（Issue #56）の木構造と、それに対する純粋関数の操作。
//
// PR 3（`tabs/useTabs.ts`）で木を導入した。木は常に leaf 1枚で、`splitPane` を
// 呼ぶ経路はまだどこにも無い。分割を有効化するのは PR 4
// （`.claude/workspace/issue-56/design-review.md`「3. 改訂した導入計画」）。
// PR 3 は「UI を1行も変えない」ことが関門だったため、ここに書くのは
// 純粋なデータ構造とその操作だけのまま維持する。
//
// 設計の唯一の正は `.claude/workspace/issue-56/design-review.md`。特に次の3点：
//
// 1. PTY のメタ（ptyId / kind / title / agentSessionId / cwd / exit）は
//    leaf に持たせる。`TabState` に残すと markExited・終了バッジ・タスク一覧の
//    突き合わせが壊れる（同ドキュメント Q4）。
// 2. `PaneNode` は `src/shared/` に置かない。Renderer 内のレイアウト表現であって
//    IPC の語彙ではない（同ドキュメント 提案 A'・非目標）。
// 3. 分割の可否と ratio のクランプは「実セル幅 x 20桁」で判定する。比率だけの
//    クランプ（0.1〜0.9 等）では fontSize を追跡できず、既定 1200px で
//    ratio 0.1 は5桁にしかならない一方、フォントを 26px に上げたユーザーだけが
//    別の閾値で壊れる（同ドキュメント U3）。
//
//    **これは幅（列数）だけの話ではない。** 上下分割は高さを2つに分けるので、
//    同じ理屈が行送り（cellHeightPx）と行数にもそのまま当てはまる。design-review
//    が幅を例に説明したのは「そちらで説明したから」であって、高さを免除した
//    わけではない（レビュー指摘。初版はここを「行数の下限は非目標」と誤って
//    断定していたが、design-review.md の「## 5. 非目標」にその記述は無い）。
//    そのため幅・高さの両方を実測ベースで判定する（下記 MIN_PANE_COLUMNS /
//    MIN_PANE_ROWS）。
//
// **Date.now() / Math.random() / window / document には一切触れない。**
// leaf の ID・PTY の起動は呼び出し側の責務（`resizeGate.ts` / `computeYourTurnSince`
// と同じ、判定と木の操作だけを持つ小さな純粋関数の形に揃えてある）。
//
// **不変（immutable）に書く。** すべての操作は新しい木を返し、既存のノードを
// 書き換えない（React の再レンダリングと相性を取るため）。

import type { PtyKind } from '@shared/ipc';

/** 左右分割（`row`）は縦線のスプリッタで幅を分け、上下分割（`column`）は
 *  横線のスプリッタで高さを分ける。CSS Flexbox の `flex-direction` と同じ意味。 */
export type SplitDirection = 'row' | 'column';

/** ペイン1枚（PTY 1本）。PTY のメタは全てここに持つ（design-review Q4）。 */
export interface PaneLeaf {
  kind: 'leaf';
  /** ペインを一意に識別する ID。採番は呼び出し側の責務（このモジュールは触らない）。 */
  paneId: string;
  ptyId: string;
  ptyKind: PtyKind;
  title: string;
  /** claude を起動した場合の --session-id。タスク一覧との突き合わせに使う。 */
  agentSessionId?: string;
  cwd?: string;
  exit?: { exitCode: number; signal?: number };
}

/** 分割ノード。子は必ず2つ（二分木）。`ratio` は最初の子（children[0]）の取り分。 */
export interface PaneSplit {
  kind: 'split';
  dir: SplitDirection;
  children: [PaneNode, PaneNode];
  ratio: number;
}

export type PaneNode = PaneLeaf | PaneSplit;

/**
 * 木の中の1ノードへの経路。ルートからの各分岐で、最初の子なら 0、
 * 2番目の子なら 1 を並べる（空配列はルート自身を指す）。
 *
 * `PaneSplit` は ID を持たない（design-review の型定義どおり）ので、任意の
 * 深さの分割ノードを一意に指すには経路で辿るしかない。leaf は `paneId` で
 * 直接引けるが、`ratio` の更新対象になる分割ノードは leaf ではないため、
 * `findPanePath` で得た経路をそのまま使う（詳しくは `updateSplitRatio` 参照）。
 */
export type PanePath = readonly number[];

/** 分割・ratio クランプの判定に使う、分割対象ペインの実測値。幅・高さの両軸を持つ。 */
export interface PaneCellMetrics {
  /** 分割対象ペインの現在の実ピクセル幅。 */
  widthPx: number;
  /** 1文字あたりの実セル幅（フォントサイズに応じて変わる）。 */
  cellWidthPx: number;
  /** 分割対象ペインの現在の実ピクセル高さ。 */
  heightPx: number;
  /** 1行あたりの実セル高さ（行送り。フォントサイズに応じて変わる）。 */
  cellHeightPx: number;
}

/** 分割後、両側に最低限確保する列数（design-review U3）。 */
export const MIN_PANE_COLUMNS = 20;

/**
 * 分割後、両側に最低限確保する行数。
 *
 * `MIN_PANE_COLUMNS`（20）と対称の値として決めた。行数だけを別基準にする
 * 積極的な理由が無く（ターミナルの可読性という同じ目的に対して、列と行を
 * 別の閾値にする根拠が無い）、根拠のない非対称な数字を置くよりも、幅で
 * 説明済みの理屈をそのまま流用できる 20 に揃えるほうが説明可能
 * （レビュー指摘: 数字を決めたらその根拠をコメントに書くこと）。
 *
 * 実例: 既定ウィンドウ高さ 800px・フォント 26px（行送り約 31px）で上下分割
 * すると、ratio 0.1 側は 800*0.1/31 ≈ 2.6 行しか残らない。シェルのプロンプト
 * 1行 + 折り返した出力1行 + 次のプロンプトで既に埋まり、幅の5桁問題
 * （U3）とまったく同じ壊れ方をする。
 */
export const MIN_PANE_ROWS = 20;

/** メトリクスが取得できない異常時（widthPx / heightPx が 0 以下）だけに使う、比率だけのフォールバック下限。 */
const FALLBACK_RATIO_MIN = 0.1;
/** メトリクスが取得できない異常時だけに使う、比率だけのフォールバック上限。 */
const FALLBACK_RATIO_MAX = 0.9;

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * leaf 1枚だけの木を作る。`PaneNode` は leaf 単体でも合法な木なので、
 * この関数は実質 leaf をそのまま返すだけだが、「1枚の木を作る」という
 * 意図を呼び出し側のコードに残すために用意する。
 */
export function createPaneTree(leaf: PaneLeaf): PaneNode {
  return leaf;
}

/** 現在の幅が、既存の分割（ネストした列方向の分割）で既に閾値未満になっていないかを見る。 */
function fitsMinWidth(metrics: PaneCellMetrics): boolean {
  return metrics.widthPx >= metrics.cellWidthPx * MIN_PANE_COLUMNS;
}

/** 現在の高さが、既存の分割（ネストした行方向の分割）で既に閾値未満になっていないかを見る。 */
function fitsMinHeight(metrics: PaneCellMetrics): boolean {
  return metrics.heightPx >= metrics.cellHeightPx * MIN_PANE_ROWS;
}

/**
 * 指定した方向に分割してよいかどうかを判定する。幅・高さの両軸を対称に見る。
 *
 * - `dir === 'row'`（左右分割）: 幅が2つに分かれるので、中央（ratio 0.5）で
 *   割った場合の各側の幅が `MIN_PANE_COLUMNS` 桁ぶんを確保できるかを見る。
 *   中央より偏った ratio は `clampSplitRatio` が別途クランプするので、
 *   ここでは「そもそも分割する余地があるか」だけを見ればよい。
 *   高さは両側とも変わらないため、既存の高さが `MIN_PANE_ROWS` 行を
 *   割っていないか（ネストした上下分割で既に狭まっていないか）だけ見る。
 * - `dir === 'column'`（上下分割）: 高さが2つに分かれるので、中央で割った
 *   場合の各側の高さが `MIN_PANE_ROWS` 行ぶんを確保できるかを見る。
 *   幅は両側とも変わらないため、既存の幅が `MIN_PANE_COLUMNS` 桁を
 *   割っていないかだけ見る（U3 の指摘を高さにも対称に適用したもの。
 *   幅だけを見て「行数の下限は非目標」と断定していたのは誤り）。
 */
export function canSplitPane(metrics: PaneCellMetrics, dir: SplitDirection): boolean {
  const widthOk =
    dir === 'row' ? metrics.widthPx >= metrics.cellWidthPx * MIN_PANE_COLUMNS * 2 : fitsMinWidth(metrics);
  const heightOk =
    dir === 'column'
      ? metrics.heightPx >= metrics.cellHeightPx * MIN_PANE_ROWS * 2
      : fitsMinHeight(metrics);
  return widthOk && heightOk;
}

/**
 * `ratio` を実測値（実セル幅 x `MIN_PANE_COLUMNS` 桁、または実セル高さ x
 * `MIN_PANE_ROWS` 行）から逆算した範囲にクランプする。幅・高さの両軸を対称に扱う。
 *
 * - `dir === 'row'`: 両側の幅が最低幅を割らない ratio の範囲を実測値から
 *   逆算してクランプする。既定 1200px・13px セルの前提だけに頼らないので、
 *   フォントサイズが変わっても閾値が正しく動く（design-review U3）。
 * - `dir === 'column'`: 同じ理屈を高さに適用する。既定 800px・26px フォント
 *   （行送り約 31px）で ratio 0.1 にすると約2.6行しか残らないという壊れ方を
 *   実測ベースの下限で防ぐ。
 *
 * `widthPx` / `heightPx` が 0 以下（メトリクスが取得できない異常時）は
 * 比率だけのフォールバック（`FALLBACK_RATIO_MIN`〜`MAX`）にする。
 */
export function clampSplitRatio(
  metrics: PaneCellMetrics,
  dir: SplitDirection,
  ratio: number,
): number {
  const extentPx = dir === 'row' ? metrics.widthPx : metrics.heightPx;
  const cellExtentPx = dir === 'row' ? metrics.cellWidthPx : metrics.cellHeightPx;
  const minCells = dir === 'row' ? MIN_PANE_COLUMNS : MIN_PANE_ROWS;

  if (extentPx <= 0) return clampNumber(ratio, FALLBACK_RATIO_MIN, FALLBACK_RATIO_MAX);

  const minExtentPx = cellExtentPx * minCells;
  const minRatio = minExtentPx / extentPx;
  const maxRatio = 1 - minRatio;
  // 分割対象の軸が2 x minCells に満たない（canSplitPane が false を返すはずの）
  // 状況で誤って呼ばれた場合の防御。中央で妥協する。
  if (minRatio > maxRatio) return 0.5;
  return clampNumber(ratio, minRatio, maxRatio);
}

/**
 * `canSplitPane` が拒否した理由を、通知バナーに出せる日本語の文にする。
 *
 * design-review.md「必ず守る設計判断」: 分割を拒否したときは理由を通知に出す。
 * 閾値そのもの（実セル幅・実セル高さ x `MIN_PANE_COLUMNS`/`MIN_PANE_ROWS`）は
 * `canSplitPane` の docstring が唯一の正なので、ここでは繰り返さない。
 */
export function describeSplitRejection(dir: SplitDirection): string {
  return dir === 'row'
    ? `分割できません（左右に分割すると各ペインが ${MIN_PANE_COLUMNS} 桁未満になります）`
    : `分割できません（上下に分割すると各ペインが ${MIN_PANE_ROWS} 行未満になります）`;
}

/** 木の中から、指定した経路のノードを取り出す。経路が leaf の先まで続いていた場合は undefined。 */
export function getNodeAtPath(tree: PaneNode, path: PanePath): PaneNode | undefined {
  let node: PaneNode = tree;
  for (const index of path) {
    if (node.kind === 'leaf') return undefined;
    node = node.children[index === 0 ? 0 : 1];
  }
  return node;
}

/** 指定した paneId を持つ leaf への経路を探す。見つからなければ undefined。 */
export function findPanePath(tree: PaneNode, paneId: string): PanePath | undefined {
  if (tree.kind === 'leaf') return tree.paneId === paneId ? [] : undefined;

  const [first, second] = tree.children;
  const firstPath = findPanePath(first, paneId);
  if (firstPath !== undefined) return [0, ...firstPath];

  const secondPath = findPanePath(second, paneId);
  if (secondPath !== undefined) return [1, ...secondPath];

  return undefined;
}

/** 木を平坦化して、leaf を（左上から順に）配列で返す。 */
export function flattenPaneTree(tree: PaneNode): PaneLeaf[] {
  if (tree.kind === 'leaf') return [tree];
  return [...flattenPaneTree(tree.children[0]), ...flattenPaneTree(tree.children[1])];
}

/** 指定した paneId を持つ leaf をそのまま返す。見つからない、または分割ノードだった場合は undefined。 */
export function getLeaf(tree: PaneNode, paneId: string): PaneLeaf | undefined {
  const path = findPanePath(tree, paneId);
  if (path === undefined) return undefined;
  const node = getNodeAtPath(tree, path);
  return node?.kind === 'leaf' ? node : undefined;
}

/**
 * `activePaneId` に対応する leaf を返す。見つからない場合は木の先頭（左上）の
 * leaf にフォールバックする（呼び出し側は必ず1枚の leaf を表示できる前提で書ける）。
 *
 * PR 3 の時点では木は常に leaf 1枚で、その `paneId` が `activePaneId` と
 * 一致するためフォールバックには実際には到達しない。分割が有効になる PR 4 以降、
 * `activePaneId` の同期が一瞬ずれても呼び出し側を壊さないための防御
 * （鉄則5「外部フォーマットのパース失敗でアプリを落とさない」と同じ考え方を
 * 木の内部整合性にも適用したもの）。
 */
export function resolveActiveLeaf(tree: PaneNode, activePaneId: string): PaneLeaf {
  return getLeaf(tree, activePaneId) ?? flattenPaneTree(tree)[0];
}

/** 経路上のノードを新しいノードで置き換えた木を返す（不変）。経路が不整合なら元の木をそのまま返す。 */
function replaceAtPath(node: PaneNode, path: PanePath, replacement: PaneNode): PaneNode {
  if (path.length === 0) return replacement;
  if (node.kind === 'leaf') return node;

  const [index, ...rest] = path;
  const childIndex = index === 0 ? 0 : 1;
  const updatedChild = replaceAtPath(node.children[childIndex], rest, replacement);
  const children: [PaneNode, PaneNode] =
    childIndex === 0 ? [updatedChild, node.children[1]] : [node.children[0], updatedChild];

  return { ...node, children };
}

/**
 * 指定した leaf を指定方向へ分割する。既存の leaf が最初の子、`newLeaf` が
 * 2番目の子になる（`dir: 'row'` なら新しいペインは右、`'column'` なら下）。
 *
 * - 対象の paneId が見つからない、または `canSplitPane` が拒否した場合は
 *   `null` を返す（呼び出し側で「分割できない」として扱う）。
 * - `ratio` の既定値は 0.5（中央）。渡された値は `clampSplitRatio` で丸める。
 */
export function splitPane(
  tree: PaneNode,
  targetPaneId: string,
  dir: SplitDirection,
  newLeaf: PaneLeaf,
  metrics: PaneCellMetrics,
  ratio = 0.5,
): PaneNode | null {
  const path = findPanePath(tree, targetPaneId);
  if (path === undefined) return null;
  if (!canSplitPane(metrics, dir)) return null;

  const existingLeaf = getNodeAtPath(tree, path);
  if (existingLeaf === undefined || existingLeaf.kind !== 'leaf') return null;

  const splitNode: PaneSplit = {
    kind: 'split',
    dir,
    children: [existingLeaf, newLeaf],
    ratio: clampSplitRatio(metrics, dir, ratio),
  };

  return replaceAtPath(tree, path, splitNode);
}

export interface ClosePaneResult {
  tree: PaneNode;
  /** 閉じた後にアクティブにすべきペイン（畳んだ側の先頭 leaf）。 */
  activePaneId: string;
}

/**
 * 指定した leaf を閉じる。
 *
 * 兄弟（同じ分割ノードのもう一方の子）が親の位置を置き換える形で木を畳む。
 * 兄弟が leaf 1枚なら見た目どおり「兄弟が親を置き換える」になり、兄弟が
 * さらに分割された部分木であってもこの一般化がそのまま成り立つ
 * （どちらの場合も「2つの子を持つ分割ノードを、残った側の子1つに置き換える」
 * という同じ操作）。
 *
 * 木にペインが1枚しかない（閉じようとした leaf がルート自身）場合は畳む先が
 * 無いため `null` を返す。タブそのものを閉じるかどうかは呼び出し側の判断。
 */
export function closePane(tree: PaneNode, paneId: string): ClosePaneResult | null {
  const path = findPanePath(tree, paneId);
  if (path === undefined) return null;
  if (path.length === 0) return null;

  const parentPath = path.slice(0, -1);
  const childIndex = path[path.length - 1];
  const parent = getNodeAtPath(tree, parentPath);
  if (parent === undefined || parent.kind !== 'split') return null;

  const sibling = parent.children[childIndex === 0 ? 1 : 0];
  const newTree = replaceAtPath(tree, parentPath, sibling);
  const activePaneId = flattenPaneTree(sibling)[0].paneId;

  return { tree: newTree, activePaneId };
}

/** 平坦化した順で次の leaf の paneId を返す（末尾は先頭へ折り返す）。見つからなければそのまま返す。 */
export function nextPane(tree: PaneNode, activePaneId: string): string {
  const leaves = flattenPaneTree(tree);
  const index = leaves.findIndex((leaf) => leaf.paneId === activePaneId);
  if (index === -1) return activePaneId;
  return leaves[(index + 1) % leaves.length].paneId;
}

/** 平坦化した順で前の leaf の paneId を返す(先頭は末尾へ折り返す)。見つからなければそのまま返す。 */
export function previousPane(tree: PaneNode, activePaneId: string): string {
  const leaves = flattenPaneTree(tree);
  const index = leaves.findIndex((leaf) => leaf.paneId === activePaneId);
  if (index === -1) return activePaneId;
  return leaves[(index - 1 + leaves.length) % leaves.length].paneId;
}

export type MoveDirection = 'up' | 'down' | 'left' | 'right';

interface PaneRect {
  paneId: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// 浮動小数の誤差を吸収するための許容誤差。
const RECT_EPSILON = 1e-6;

/** 木の各 leaf を、[0,1] x [0,1] の正規化座標での矩形として列挙する。 */
function collectPaneRects(
  node: PaneNode,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): PaneRect[] {
  if (node.kind === 'leaf') return [{ paneId: node.paneId, x0, y0, x1, y1 }];

  const [first, second] = node.children;
  if (node.dir === 'row') {
    const splitX = x0 + (x1 - x0) * node.ratio;
    return [
      ...collectPaneRects(first, x0, y0, splitX, y1),
      ...collectPaneRects(second, splitX, y0, x1, y1),
    ];
  }

  const splitY = y0 + (y1 - y0) * node.ratio;
  return [
    ...collectPaneRects(first, x0, y0, x1, splitY),
    ...collectPaneRects(second, x0, splitY, x1, y1),
  ];
}

function rangesOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return Math.min(a1, b1) - Math.max(a0, b0) > RECT_EPSILON;
}

/**
 * アクティブなペインから見て指定方向にある leaf のうち、最も近いものの paneId を返す。
 *
 * 木のレイアウトを [0,1] x [0,1] の矩形に展開し、進行方向側にあって
 * 垂直方向（移動が左右なら y、上下なら x）が重なる leaf だけを候補にする。
 * 候補が無ければ端に到達しているということなので、`activePaneId` をそのまま返す
 * （4方向移動は次/前と違い、折り返さない。iTerm2 等の空間移動と同じ扱い）。
 */
export function movePaneInDirection(
  tree: PaneNode,
  activePaneId: string,
  direction: MoveDirection,
): string {
  const rects = collectPaneRects(tree, 0, 0, 1, 1);
  const current = rects.find((r) => r.paneId === activePaneId);
  if (current === undefined) return activePaneId;

  const candidates = rects.filter((r) => {
    if (r.paneId === activePaneId) return false;
    switch (direction) {
      case 'right':
        return (
          r.x0 >= current.x1 - RECT_EPSILON && rangesOverlap(r.y0, r.y1, current.y0, current.y1)
        );
      case 'left':
        return (
          r.x1 <= current.x0 + RECT_EPSILON && rangesOverlap(r.y0, r.y1, current.y0, current.y1)
        );
      case 'down':
        return (
          r.y0 >= current.y1 - RECT_EPSILON && rangesOverlap(r.x0, r.x1, current.x0, current.x1)
        );
      case 'up':
        return (
          r.y1 <= current.y0 + RECT_EPSILON && rangesOverlap(r.x0, r.x1, current.x0, current.x1)
        );
      default:
        return false;
    }
  });

  if (candidates.length === 0) return activePaneId;

  const distanceAlongAxis = (r: PaneRect): number => {
    switch (direction) {
      case 'right':
        return r.x0 - current.x1;
      case 'left':
        return current.x0 - r.x1;
      case 'down':
        return r.y0 - current.y1;
      case 'up':
        return current.y0 - r.y1;
      default:
        return Number.POSITIVE_INFINITY;
    }
  };

  return candidates.reduce((closest, candidate) =>
    distanceAlongAxis(candidate) < distanceAlongAxis(closest) ? candidate : closest,
  ).paneId;
}

/**
 * 経路で指定した分割ノードの `ratio` を更新する（クランプ込み）。
 *
 * `PaneSplit` は ID を持たないため、`findPanePath` で得た経路（または木の
 * 構築時に呼び出し側が保持している経路）で対象を指定する。経路の先が
 * 分割ノードでない場合は何もせず元の木を返す（防御的。呼び出し側の
 * 経路計算がずれても木を壊さない）。
 */
export function updateSplitRatio(
  tree: PaneNode,
  path: PanePath,
  ratio: number,
  metrics: PaneCellMetrics,
): PaneNode {
  const target = getNodeAtPath(tree, path);
  if (target === undefined || target.kind !== 'split') return tree;

  const clamped = clampSplitRatio(metrics, target.dir, ratio);
  if (clamped === target.ratio) return tree;

  return replaceAtPath(tree, path, { ...target, ratio: clamped });
}

/**
 * 指定した paneId を持つ leaf を、`patch` でマージした内容に置き換えた木を
 * 返す（不変）。対象の paneId が見つからない場合は元の木をそのまま返す。
 *
 * PTY のメタ（ptyId / kind / title / agentSessionId / cwd / exit）を leaf に
 * 持たせたことで生まれた更新経路（design-review.md Q4）。cwd の追従・exit の
 * 記録・タイトルの手動編集はすべてこの関数を通す。`kind` / `paneId` は
 * `patch` の型から除外してあり、構造を壊す更新（leaf を split に化けさせる、
 * 別の paneId を名乗らせる）を型で防ぐ。
 */
export function updateLeaf(
  tree: PaneNode,
  paneId: string,
  patch: Partial<Omit<PaneLeaf, 'kind' | 'paneId'>>,
): PaneNode {
  const path = findPanePath(tree, paneId);
  if (path === undefined) return tree;
  const node = getNodeAtPath(tree, path);
  if (node === undefined || node.kind !== 'leaf') return tree;

  return replaceAtPath(tree, path, { ...node, ...patch });
}
