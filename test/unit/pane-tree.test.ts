// タブ内ペイン分割（Issue #56 PR 2）の木構造と純粋関数の単体テスト。
//
// この時点でこのモジュールはどこからも import されていない（PR 3 で木を導入、
// PR 4 で分割を有効化）。ここでは design-review.md が指摘した3点だけを
// 重点的に固定する。
//
// - 分割の拒否条件（「実セル幅 x 20桁」。fontSize が変わっても閾値が動くこと）。
//   幅（左右分割）だけでなく、高さ（上下分割・行送り）にも対称に効くこと
//   （レビュー指摘: 幅の例だけを見て「行数の下限は非目標」と断定していたのは
//   design-review.md に無い誤り。U3 とまったく同じ壊れ方が高さにもある）
// - ratio のクランプ（比率だけでなく実測値ベースであること。幅・高さ両軸）
// - 木を畳む条件（兄弟が親を置き換える。兄弟が leaf でも部分木でも同じ操作）
// - 方向移動の端の扱い（次/前は折り返す。4方向は端で折り返さず据え置く）

import { describe, expect, it } from 'vitest';
import {
  canSplitPane,
  clampSplitRatio,
  closePane,
  createPaneTree,
  findPanePath,
  flattenPaneTree,
  getLeaf,
  getNodeAtPath,
  MIN_PANE_COLUMNS,
  MIN_PANE_ROWS,
  movePaneInDirection,
  nextPane,
  previousPane,
  resolveActiveLeaf,
  splitPane,
  updateLeaf,
  updateSplitRatio,
  type PaneCellMetrics,
  type PaneLeaf,
  type PaneNode,
  type PaneSplit,
} from '../../src/renderer/src/tabs/paneTree';

function leaf(paneId: string): PaneLeaf {
  return {
    kind: 'leaf',
    paneId,
    ptyId: `pty-${paneId}`,
    ptyKind: 'shell',
    title: paneId,
  };
}

function splitRow(ratio: number, children: [PaneNode, PaneNode]): PaneSplit {
  return { kind: 'split', dir: 'row', children, ratio };
}

function splitColumn(ratio: number, children: [PaneNode, PaneNode]): PaneSplit {
  return { kind: 'split', dir: 'column', children, ratio };
}

// 十分に広い既定値（実質どちらの軸の閾値にも引っかからない）を基準に、
// テストごとに検証したい軸だけを上書きする。
const ROOMY_WIDTH_PX = 1200;
const ROOMY_HEIGHT_PX = 800;
const NORMAL_CELL_WIDTH_PX = 13;
const NORMAL_CELL_HEIGHT_PX = 18;

function metrics(overrides: Partial<PaneCellMetrics> = {}): PaneCellMetrics {
  return {
    widthPx: ROOMY_WIDTH_PX,
    cellWidthPx: NORMAL_CELL_WIDTH_PX,
    heightPx: ROOMY_HEIGHT_PX,
    cellHeightPx: NORMAL_CELL_HEIGHT_PX,
    ...overrides,
  };
}

describe('createPaneTree', () => {
  it('leaf 1枚をそのまま木として返す', () => {
    const a = leaf('a');
    expect(createPaneTree(a)).toBe(a);
  });
});

describe('canSplitPane（分割の拒否条件・幅と高さの両軸）', () => {
  it('左右分割: 幅・高さが十分あれば許可する', () => {
    expect(canSplitPane(metrics(), 'row')).toBe(true);
  });

  it('左右分割: 中央で割っても片側が MIN_PANE_COLUMNS 桁を割るなら拒否する', () => {
    // 40 * cellWidthPx ちょうどが境界（片側 20 桁ずつ）。
    const cellWidthPx = 13;
    const boundary = metrics({ widthPx: MIN_PANE_COLUMNS * 2 * cellWidthPx, cellWidthPx });
    const tooNarrow = metrics({ widthPx: MIN_PANE_COLUMNS * 2 * cellWidthPx - 1, cellWidthPx });
    expect(canSplitPane(boundary, 'row')).toBe(true);
    expect(canSplitPane(tooNarrow, 'row')).toBe(false);
  });

  it('フォントサイズが大きいユーザーだけが同じピクセル幅で拒否される（横方向, design-review U3）', () => {
    // 1回目の左右分割で 1200px -> 600px の半分ペインができた状況を想定し、
    // それをもう一段左右分割しようとするケース。
    const halfWidthPx = 600;
    const normalFont = metrics({ widthPx: halfWidthPx, cellWidthPx: 13 });
    const largeFont = metrics({ widthPx: halfWidthPx, cellWidthPx: 26 });

    // 通常の 13px セルなら 600px でもまだ 2 x 20 桁を確保できる。
    expect(canSplitPane(normalFont, 'row')).toBe(true);
    // フォントを 26px に上げたユーザーは、同じ 600px でも 2 x 20 桁を割るため拒否される。
    // 比率だけの固定クランプ（0.1〜0.9）ではこの違いを検出できない、というのが
    // design-review が指摘した問題そのもの。
    expect(canSplitPane(largeFont, 'row')).toBe(false);
  });

  it('左右分割: 列数は変えるが行数は変えないので、既に上下分割で高さが閾値未満なら拒否する', () => {
    const tooShort = metrics({ heightPx: 100, cellHeightPx: 18 });
    expect(canSplitPane(tooShort, 'row')).toBe(false);
  });

  it('上下分割: 幅・高さが十分あれば許可する', () => {
    expect(canSplitPane(metrics(), 'column')).toBe(true);
  });

  it('上下分割: 中央で割っても片側が MIN_PANE_ROWS 行を割るなら拒否する', () => {
    // 40 * cellHeightPx ちょうどが境界（片側 20 行ずつ）。MIN_PANE_COLUMNS と
    // 対称の境界テスト（U3 は横方向だけを例にしていたが、縦方向にも同じ形の
    // 境界が必要）。
    const cellHeightPx = 18;
    const boundary = metrics({ heightPx: MIN_PANE_ROWS * 2 * cellHeightPx, cellHeightPx });
    const tooShort = metrics({ heightPx: MIN_PANE_ROWS * 2 * cellHeightPx - 1, cellHeightPx });
    expect(canSplitPane(boundary, 'column')).toBe(true);
    expect(canSplitPane(tooShort, 'column')).toBe(false);
  });

  it('行送りが大きいユーザーだけが同じピクセル高さで拒否される（縦方向, U3 と対称）', () => {
    // 横方向の「フォントサイズが大きいユーザーだけが拒否される」テストと
    // 全く同じ数値・同じ理屈を縦方向（行送り）に適用したもの。
    // U3 は幅の例で説明していたが、高さにも同じ壊れ方が存在する
    // （既定 800px・26px フォント・行送り約31pxで ratio 0.1 は約2.6行）。
    const halfHeightPx = 600;
    const normalLineHeight = metrics({ heightPx: halfHeightPx, cellHeightPx: 13 });
    const largeLineHeight = metrics({ heightPx: halfHeightPx, cellHeightPx: 26 });

    expect(canSplitPane(normalLineHeight, 'column')).toBe(true);
    expect(canSplitPane(largeLineHeight, 'column')).toBe(false);
  });

  it('上下分割: 行数は変えるが列数は変えないので、既に左右分割で幅が閾値未満なら拒否する', () => {
    const tooNarrow = metrics({ widthPx: 100, cellWidthPx: 13 });
    expect(canSplitPane(tooNarrow, 'column')).toBe(false);
  });
});

describe('clampSplitRatio（ratio のクランプ・幅と高さの両軸）', () => {
  it('左右分割: 範囲内の ratio はそのまま', () => {
    expect(clampSplitRatio(metrics(), 'row', 0.5)).toBe(0.5);
  });

  it('左右分割: 実セル幅から逆算した下限/上限でクランプする（固定値ではない）', () => {
    // widthPx=1200, cellWidthPx=26 のとき、片側最低幅 = 26*20 = 520px。
    // minRatio = 520/1200 = 0.4333...、これは固定値 0.1 よりずっと大きい。
    const widthPx = 1200;
    const cellWidthPx = 26;
    const m = metrics({ widthPx, cellWidthPx });
    const minRatio = (cellWidthPx * MIN_PANE_COLUMNS) / widthPx;

    expect(clampSplitRatio(m, 'row', 0.01)).toBeCloseTo(minRatio, 10);
    expect(clampSplitRatio(m, 'row', 0.99)).toBeCloseTo(1 - minRatio, 10);
  });

  it('左右分割: 分割不能なほど狭い場合は中央 0.5 に丸める（防御的フォールバック）', () => {
    const m = metrics({ widthPx: 10, cellWidthPx: 13 });
    expect(clampSplitRatio(m, 'row', 0.9)).toBe(0.5);
  });

  it('上下分割: 実セル高さから逆算した下限/上限でクランプする（固定値ではない。U3 を高さに対称適用）', () => {
    // heightPx=1200, cellHeightPx=26 のとき、片側最低高さ = 26*20 = 520px。
    // minRatio = 520/1200 = 0.4333...。左右分割の例と全く同じ数値・同じ形で、
    // 高さでも固定値クランプ（0.1）よりずっと厳しい下限が実測から出る。
    const heightPx = 1200;
    const cellHeightPx = 26;
    const m = metrics({ heightPx, cellHeightPx });
    const minRatio = (cellHeightPx * MIN_PANE_ROWS) / heightPx;

    expect(clampSplitRatio(m, 'column', 0.01)).toBeCloseTo(minRatio, 10);
    expect(clampSplitRatio(m, 'column', 0.99)).toBeCloseTo(1 - minRatio, 10);
  });

  it('上下分割: 分割不能なほど低い場合は中央 0.5 に丸める（防御的フォールバック）', () => {
    const m = metrics({ heightPx: 10, cellHeightPx: 18 });
    expect(clampSplitRatio(m, 'column', 0.9)).toBe(0.5);
  });

  it('メトリクスが取得できない異常時（widthPx <= 0）は比率だけのフォールバック（0.1〜0.9）を使う', () => {
    const m = metrics({ widthPx: 0 });
    expect(clampSplitRatio(m, 'row', 0.01)).toBe(0.1);
    expect(clampSplitRatio(m, 'row', 0.99)).toBe(0.9);
  });

  it('メトリクスが取得できない異常時（heightPx <= 0）は比率だけのフォールバック（0.1〜0.9）を使う', () => {
    const m = metrics({ heightPx: 0 });
    expect(clampSplitRatio(m, 'column', 0.01)).toBe(0.1);
    expect(clampSplitRatio(m, 'column', 0.99)).toBe(0.9);
  });
});

describe('splitPane', () => {
  it('leaf を指定方向に分割し、既存 leaf が先頭・新規 leaf が2番目になる', () => {
    const a = leaf('a');
    const b = leaf('b');
    const result = splitPane(a, 'a', 'row', b, metrics());

    expect(result).not.toBeNull();
    expect(result).toEqual(splitRow(0.5, [a, b]));
  });

  it('対象の paneId が見つからなければ null', () => {
    const a = leaf('a');
    const b = leaf('b');
    expect(splitPane(a, 'missing', 'row', b, metrics())).toBeNull();
  });

  it('canSplitPane が拒否するほど狭い場合は null（分割を拒否する。横方向）', () => {
    const a = leaf('a');
    const b = leaf('b');
    const narrow = metrics({ widthPx: 100, cellWidthPx: 13 });
    expect(splitPane(a, 'a', 'row', b, narrow)).toBeNull();
  });

  it('canSplitPane が拒否するほど低い場合は null（分割を拒否する。縦方向）', () => {
    const a = leaf('a');
    const b = leaf('b');
    const tooShort = metrics({ heightPx: 100, cellHeightPx: 18 });
    expect(splitPane(a, 'a', 'column', b, tooShort)).toBeNull();
  });

  it('ネストした木の中の leaf も分割できる（他の枝は変わらない）', () => {
    const a = leaf('a');
    const b = leaf('b');
    const c = leaf('c');
    const tree = splitRow(0.5, [a, b]);

    const result = splitPane(tree, 'b', 'column', c, metrics());

    expect(result).toEqual(splitRow(0.5, [a, splitColumn(0.5, [b, c])]));
    // 触っていない側の枝は同一参照のまま（構造共有）。
    expect((result as PaneSplit).children[0]).toBe(a);
  });

  it('指定した ratio がクランプされて反映される（横方向）', () => {
    const a = leaf('a');
    const b = leaf('b');
    const widthPx = 1200;
    const cellWidthPx = 26;
    const m = metrics({ widthPx, cellWidthPx });
    const minRatio = (cellWidthPx * MIN_PANE_COLUMNS) / widthPx;

    const result = splitPane(a, 'a', 'row', b, m, 0.01) as PaneSplit;
    expect(result.ratio).toBeCloseTo(minRatio, 10);
  });

  it('指定した ratio がクランプされて反映される（縦方向）', () => {
    const a = leaf('a');
    const b = leaf('b');
    const heightPx = 1200;
    const cellHeightPx = 26;
    const m = metrics({ heightPx, cellHeightPx });
    const minRatio = (cellHeightPx * MIN_PANE_ROWS) / heightPx;

    const result = splitPane(a, 'a', 'column', b, m, 0.01) as PaneSplit;
    expect(result.ratio).toBeCloseTo(minRatio, 10);
  });
});

describe('closePane（木を畳む条件）', () => {
  it('兄弟が leaf 1枚なら、その leaf が親を置き換える', () => {
    const a = leaf('a');
    const b = leaf('b');
    const tree = splitRow(0.5, [a, b]);

    const result = closePane(tree, 'b');

    expect(result).not.toBeNull();
    expect(result?.tree).toBe(a);
    expect(result?.activePaneId).toBe('a');
  });

  it('兄弟が部分木でも同じ操作で畳まれる（部分木がそのまま親を置き換える）', () => {
    const a = leaf('a');
    const b = leaf('b');
    const c = leaf('c');
    const siblingSubtree = splitColumn(0.5, [b, c]);
    const tree = splitRow(0.5, [a, siblingSubtree]);

    const result = closePane(tree, 'a');

    expect(result).not.toBeNull();
    expect(result?.tree).toBe(siblingSubtree);
    // 畳んだ側（部分木）の先頭 leaf がアクティブになる。
    expect(result?.activePaneId).toBe('b');
  });

  it('木がその leaf 1枚しかない（ルート自身）場合は畳む先が無く null', () => {
    const a = leaf('a');
    expect(closePane(a, 'a')).toBeNull();
  });

  it('存在しない paneId は null', () => {
    const a = leaf('a');
    const b = leaf('b');
    const tree = splitRow(0.5, [a, b]);
    expect(closePane(tree, 'missing')).toBeNull();
  });

  it('深い位置の leaf を閉じても、その直属の親だけが畳まれる', () => {
    const a = leaf('a');
    const b = leaf('b');
    const c = leaf('c');
    // root(row) -> [a, column(row内) -> [b, c]]
    const tree = splitRow(0.4, [a, splitColumn(0.6, [b, c])]);

    const result = closePane(tree, 'c');

    expect(result).not.toBeNull();
    // b が column ノードを置き換えるので、木全体は row(0.4, [a, b]) になる。
    expect(result?.tree).toEqual(splitRow(0.4, [a, b]));
    expect(result?.activePaneId).toBe('b');
  });
});

describe('flattenPaneTree', () => {
  it('leaf 単体はそのまま1件の配列', () => {
    const a = leaf('a');
    expect(flattenPaneTree(a)).toEqual([a]);
  });

  it('ネストした木を左から右・上から下の順で平坦化する', () => {
    const a = leaf('a');
    const b = leaf('b');
    const c = leaf('c');
    const d = leaf('d');
    const tree = splitRow(0.5, [splitColumn(0.5, [a, b]), splitColumn(0.5, [c, d])]);

    expect(flattenPaneTree(tree).map((l) => l.paneId)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('nextPane / previousPane', () => {
  it('次/前は末尾・先頭で折り返す', () => {
    const a = leaf('a');
    const b = leaf('b');
    const c = leaf('c');
    const tree = splitRow(0.5, [a, splitColumn(0.5, [b, c])]);

    expect(nextPane(tree, 'a')).toBe('b');
    expect(nextPane(tree, 'b')).toBe('c');
    expect(nextPane(tree, 'c')).toBe('a'); // 末尾 -> 先頭へ折り返す

    expect(previousPane(tree, 'a')).toBe('c'); // 先頭 -> 末尾へ折り返す
    expect(previousPane(tree, 'c')).toBe('b');
  });

  it('leaf 1枚のときは自分自身に折り返す', () => {
    const a = leaf('a');
    expect(nextPane(a, 'a')).toBe('a');
    expect(previousPane(a, 'a')).toBe('a');
  });

  it('存在しない paneId はそのまま返す', () => {
    const a = leaf('a');
    const b = leaf('b');
    const tree = splitRow(0.5, [a, b]);
    expect(nextPane(tree, 'missing')).toBe('missing');
    expect(previousPane(tree, 'missing')).toBe('missing');
  });
});

describe('movePaneInDirection（4方向移動と端の扱い）', () => {
  // 2x2 グリッド:
  //   a | c
  //   --+--
  //   b | d
  const a = leaf('a');
  const b = leaf('b');
  const c = leaf('c');
  const d = leaf('d');
  const grid = splitRow(0.5, [splitColumn(0.5, [a, b]), splitColumn(0.5, [c, d])]);

  it('隣接するペインへ移動する', () => {
    expect(movePaneInDirection(grid, 'a', 'right')).toBe('c');
    expect(movePaneInDirection(grid, 'a', 'down')).toBe('b');
    expect(movePaneInDirection(grid, 'd', 'left')).toBe('b');
    expect(movePaneInDirection(grid, 'd', 'up')).toBe('c');
  });

  it('端では移動先が無いため、同じペインに留まる（折り返さない）', () => {
    expect(movePaneInDirection(grid, 'a', 'up')).toBe('a');
    expect(movePaneInDirection(grid, 'a', 'left')).toBe('a');
    expect(movePaneInDirection(grid, 'd', 'right')).toBe('d');
    expect(movePaneInDirection(grid, 'd', 'down')).toBe('d');
  });

  it('leaf 1枚のときはどの方向でも自分自身に留まる', () => {
    const single = leaf('a');
    expect(movePaneInDirection(single, 'a', 'right')).toBe('a');
    expect(movePaneInDirection(single, 'a', 'left')).toBe('a');
    expect(movePaneInDirection(single, 'a', 'up')).toBe('a');
    expect(movePaneInDirection(single, 'a', 'down')).toBe('a');
  });

  it('存在しない paneId はそのまま返す', () => {
    expect(movePaneInDirection(grid, 'missing', 'right')).toBe('missing');
  });
});

describe('updateSplitRatio', () => {
  it('経路で指定した分割ノードの ratio をクランプして更新する（上下分割・実測ベースのクランプ）', () => {
    const a = leaf('a');
    const b = leaf('b');
    const c = leaf('c');
    const innerSplit = splitColumn(0.4, [b, c]);
    const tree = splitRow(0.5, [a, innerSplit]);
    // 高さに十分余裕を持たせ、0.9 がそのままクランプの範囲内に収まる前提にする。
    const m = metrics({ heightPx: 100_000, cellHeightPx: 10 });

    const result = updateSplitRatio(tree, [1], 0.9, m) as PaneSplit;

    expect((result.children[1] as PaneSplit).ratio).toBe(0.9);
    // 触っていない側（a）は構造共有で同一参照のまま。
    expect(result.children[0]).toBe(a);
  });

  it('経路で指定した分割ノードの ratio が、狭い実測値の範囲でクランプされる', () => {
    const a = leaf('a');
    const b = leaf('b');
    const c = leaf('c');
    const heightPx = 1200;
    const cellHeightPx = 26;
    const innerSplit = splitColumn(0.5, [b, c]);
    const tree = splitRow(0.5, [a, innerSplit]);
    const m = metrics({ heightPx, cellHeightPx });
    const minRatio = (cellHeightPx * MIN_PANE_ROWS) / heightPx;

    const result = updateSplitRatio(tree, [1], 0.99, m) as PaneSplit;

    expect((result.children[1] as PaneSplit).ratio).toBeCloseTo(1 - minRatio, 10);
  });

  it('経路の先が分割ノードでなければ何もせず、同じ木をそのまま返す', () => {
    const a = leaf('a');
    const b = leaf('b');
    const tree = splitRow(0.5, [a, b]);

    // path [0] は leaf a を指す（split ではない）。
    const result = updateSplitRatio(tree, [0], 0.9, metrics());
    expect(result).toBe(tree);
  });

  it('クランプ後の値が現在値と同じなら、同じ木をそのまま返す', () => {
    const a = leaf('a');
    const b = leaf('b');
    const tree = splitRow(0.5, [a, b]);

    const result = updateSplitRatio(tree, [], 0.5, metrics());
    expect(result).toBe(tree);
  });
});

describe('findPanePath / getNodeAtPath', () => {
  it('leaf への経路を探し、その経路でノードを引き直せる', () => {
    const a = leaf('a');
    const b = leaf('b');
    const c = leaf('c');
    const tree = splitRow(0.5, [a, splitColumn(0.5, [b, c])]);

    expect(findPanePath(tree, 'c')).toEqual([1, 1]);
    expect(getNodeAtPath(tree, [1, 1])).toBe(c);
  });

  it('存在しない paneId は undefined', () => {
    const a = leaf('a');
    expect(findPanePath(a, 'missing')).toBeUndefined();
  });
});

describe('getLeaf（PR 3: TabState から leaf を引く経路）', () => {
  it('paneId に対応する leaf をそのまま返す', () => {
    const a = leaf('a');
    const b = leaf('b');
    const tree = splitRow(0.5, [a, b]);
    expect(getLeaf(tree, 'b')).toBe(b);
  });

  it('leaf 単体の木でも自分自身の paneId で引ける', () => {
    const a = leaf('a');
    expect(getLeaf(a, 'a')).toBe(a);
  });

  it('存在しない paneId は undefined', () => {
    const a = leaf('a');
    const b = leaf('b');
    const tree = splitRow(0.5, [a, b]);
    expect(getLeaf(tree, 'missing')).toBeUndefined();
  });
});

describe('resolveActiveLeaf（activePaneId から表示すべき leaf を決める）', () => {
  it('activePaneId に対応する leaf を返す', () => {
    const a = leaf('a');
    const b = leaf('b');
    const tree = splitRow(0.5, [a, b]);
    expect(resolveActiveLeaf(tree, 'b')).toBe(b);
  });

  it('leaf 1枚の木では、その leaf の paneId を渡せば同じ leaf が返る（PR 3 の唯一の使われ方）', () => {
    const a = leaf('a');
    expect(resolveActiveLeaf(a, 'a')).toBe(a);
  });

  it('activePaneId が木の中に見つからない場合は先頭（左上）の leaf にフォールバックする', () => {
    const a = leaf('a');
    const b = leaf('b');
    const tree = splitRow(0.5, [a, b]);
    expect(resolveActiveLeaf(tree, 'stale-id')).toBe(a);
  });
});

describe('updateLeaf（cwd 追従・exit 記録・タイトル編集の更新経路）', () => {
  it('指定した paneId の leaf を patch でマージする（不変・他の枝は変わらない）', () => {
    const a = leaf('a');
    const b = leaf('b');
    const tree = splitRow(0.5, [a, b]);

    const result = updateLeaf(tree, 'b', { cwd: '/repo' }) as PaneSplit;

    expect((result.children[1] as PaneLeaf).cwd).toBe('/repo');
    // b 自体は新しいオブジェクトに置き換わるが、a 側は同一参照のまま。
    expect(result.children[0]).toBe(a);
    expect(result.children[1]).not.toBe(b);
  });

  it('leaf 1枚の木でも paneId 一致で更新できる（PR 3 で常に通る経路）', () => {
    const a = leaf('a');
    const result = updateLeaf(a, 'a', { title: '新しいタイトル', exit: { exitCode: 1 } });
    expect(result).toEqual({ ...a, title: '新しいタイトル', exit: { exitCode: 1 } });
  });

  it('存在しない paneId は元の木をそのまま返す', () => {
    const a = leaf('a');
    const b = leaf('b');
    const tree = splitRow(0.5, [a, b]);
    const result = updateLeaf(tree, 'missing', { cwd: '/repo' });
    expect(result).toBe(tree);
  });
});
