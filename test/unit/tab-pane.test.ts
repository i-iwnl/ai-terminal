// tabs/tabPane.ts（Issue #56 PR 3 / PR 4）の単体テスト。
//
// PTY のメタ（ptyId / kind / title / agentSessionId / cwd / exit）を leaf に
// 持たせたことで生まれた、TabState から leaf を引く経路を固定する
// （design-review.md Q4）。PR 3 の時点では木は常に leaf 1枚だったが、
// PR 4 で分割が有効になり、木が複数 leaf を持ちうるようになった。
// findTabByPtyId / findTabByAgentSessionId は「アクティブな leaf 1枚だけ」
// ではなく木の全 leaf を見る必要がある（非アクティブなペインの PTY が
// 終了する・非アクティブなペインで claude/gemini が動く、のどちらも起こりうる）。

import { describe, expect, it } from 'vitest';
import type { PaneLeaf, PaneNode, PaneSplit } from '../../src/renderer/src/tabs/paneTree';
import {
  findPaneByAgentSessionId,
  findTabByAgentSessionId,
  findTabByPtyId,
  nextTabId,
  previousTabId,
  tabAllPanesExited,
  tabDisplayTitle,
  tabLeaf,
  tabRepresentativeLeaf,
  type TabState,
} from '../../src/renderer/src/tabs/tabPane';

function leaf(overrides: Partial<PaneLeaf> = {}): PaneLeaf {
  return {
    kind: 'leaf',
    paneId: 'pane-1',
    ptyId: 'pty-1',
    ptyKind: 'shell',
    title: 'zsh',
    ...overrides,
  };
}

function splitRow(children: [PaneNode, PaneNode]): PaneSplit {
  return { kind: 'split', dir: 'row', children, ratio: 0.5 };
}

function tab(overrides: Partial<TabState> & { layout?: PaneNode } = {}): TabState {
  const layout = overrides.layout ?? leaf();
  const firstLeaf = layout.kind === 'leaf' ? layout : undefined;
  return {
    id: firstLeaf?.ptyId ?? 'tab-id',
    layout,
    activePaneId: firstLeaf?.paneId ?? 'pane-1',
    createdAt: 0,
    maximized: false,
    ...overrides,
  };
}

describe('tabLeaf', () => {
  it('leaf 1枚の木では、その leaf をそのまま返す', () => {
    const t = tab();
    expect(tabLeaf(t)).toBe(t.layout);
  });
});

describe('findTabByPtyId', () => {
  it('ptyId が一致するタブを返す', () => {
    const a = tab({ layout: leaf({ paneId: 'a', ptyId: 'pty-a' }) });
    const b = tab({ layout: leaf({ paneId: 'b', ptyId: 'pty-b' }) });
    expect(findTabByPtyId([a, b], 'pty-b')).toBe(b);
  });

  it('一致するタブが無ければ undefined', () => {
    const a = tab({ layout: leaf({ paneId: 'a', ptyId: 'pty-a' }) });
    expect(findTabByPtyId([a], 'missing')).toBeUndefined();
  });

  // Issue #56 PR 4: 分割後、非アクティブな leaf（= tabLeaf() では引けない側）の
  // PTY が終了することがある。tabLeaf(t) だけを見ていると、この経路は
  // 「タブが見つからない」扱いになり、markExited が静かに no-op になっていた。
  it('分割したタブで、非アクティブな leaf の ptyId でも見つかる', () => {
    const activeLeaf = leaf({ paneId: 'active', ptyId: 'pty-active' });
    const backgroundLeaf = leaf({ paneId: 'background', ptyId: 'pty-background' });
    const t: TabState = {
      id: 'pty-active',
      layout: splitRow([activeLeaf, backgroundLeaf]),
      activePaneId: 'active',
      createdAt: 0,
      maximized: false,
    };
    expect(findTabByPtyId([t], 'pty-background')).toBe(t);
    // 従来どおりアクティブ側でも見つかること（退行していないこと）も併せて確認する。
    expect(findTabByPtyId([t], 'pty-active')).toBe(t);
  });
});

describe('findTabByAgentSessionId', () => {
  it('agentSessionId が一致するタブを返す（タスク一覧・通知クリックの突き合わせ）', () => {
    const a = tab({ layout: leaf({ paneId: 'a', ptyId: 'pty-a', agentSessionId: 'session-a' }) });
    const b = tab({ layout: leaf({ paneId: 'b', ptyId: 'pty-b', agentSessionId: 'session-b' }) });
    expect(findTabByAgentSessionId([a, b], 'session-b')).toBe(b);
  });

  it('agentSessionId を持たない leaf（shell タブ等）はヒットしない', () => {
    const shellTab = tab({ layout: leaf({ paneId: 'a', ptyId: 'pty-a' }) });
    expect(findTabByAgentSessionId([shellTab], 'session-a')).toBeUndefined();
  });

  it('一致するタブが無ければ undefined', () => {
    const a = tab({ layout: leaf({ paneId: 'a', ptyId: 'pty-a', agentSessionId: 'session-a' }) });
    expect(findTabByAgentSessionId([a], 'missing')).toBeUndefined();
  });

  // Issue #56 PR 4: 分割で非アクティブなペインに claude/gemini が動いていても、
  // そのタブ自体はタスク一覧・通知から前面化できる必要がある。
  it('分割したタブで、非アクティブな leaf の agentSessionId でも見つかる', () => {
    const shellLeaf = leaf({ paneId: 'shell', ptyId: 'pty-shell' });
    const claudeLeaf = leaf({
      paneId: 'claude',
      ptyId: 'pty-claude',
      ptyKind: 'claude',
      agentSessionId: 'session-background',
    });
    const t: TabState = {
      id: 'pty-shell',
      layout: splitRow([shellLeaf, claudeLeaf]),
      activePaneId: 'shell',
      createdAt: 0,
      maximized: false,
    };
    expect(findTabByAgentSessionId([t], 'session-background')).toBe(t);
  });
});

describe('findPaneByAgentSessionId（U4: タスク一覧・通知クリックをペイン粒度で突き合わせる）', () => {
  it('agentSessionId が一致する leaf の paneId と、そのタブの id を返す', () => {
    const shellLeaf = leaf({ paneId: 'shell', ptyId: 'pty-shell' });
    const claudeLeaf = leaf({
      paneId: 'claude',
      ptyId: 'pty-claude',
      ptyKind: 'claude',
      agentSessionId: 'session-background',
    });
    const t: TabState = {
      id: 'pty-shell',
      layout: splitRow([shellLeaf, claudeLeaf]),
      activePaneId: 'shell',
      createdAt: 0,
      maximized: false,
    };
    expect(findPaneByAgentSessionId([t], 'session-background')).toEqual({
      tabId: 'pty-shell',
      paneId: 'claude',
    });
  });

  it('対象ペインが既にアクティブでも、タブ id とペイン id を同じ形で返す（呼び出し側が「既にアクティブか」を判定できる）', () => {
    const a = tab({ layout: leaf({ paneId: 'a', ptyId: 'pty-a', agentSessionId: 'session-a' }) });
    expect(findPaneByAgentSessionId([a], 'session-a')).toEqual({ tabId: a.id, paneId: 'a' });
  });

  it('一致する leaf が無ければ undefined', () => {
    const a = tab({ layout: leaf({ paneId: 'a', ptyId: 'pty-a', agentSessionId: 'session-a' }) });
    expect(findPaneByAgentSessionId([a], 'missing')).toBeUndefined();
  });
});

// Issue #20 J（PR 14）: Cmd+Shift+] / Cmd+Shift+[ で次/前のタブへ移動する。
// paneTree.ts の nextPane / previousPane と同じ「環状・見つからなければ素通し」という
// 考え方をタブの並びに適用したもの。
describe('nextTabId / previousTabId', () => {
  const ids = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('次のタブへ進む', () => {
    expect(nextTabId(ids, 'a')).toBe('b');
    expect(nextTabId(ids, 'b')).toBe('c');
  });

  it('末尾の次は先頭へ折り返す', () => {
    expect(nextTabId(ids, 'c')).toBe('a');
  });

  it('前のタブへ戻る', () => {
    expect(previousTabId(ids, 'c')).toBe('b');
  });

  it('先頭の前は末尾へ折り返す', () => {
    expect(previousTabId(ids, 'a')).toBe('c');
  });

  it('activeTabId が一覧に無ければそのまま返す（no-op）', () => {
    expect(nextTabId(ids, 'missing')).toBe('missing');
    expect(previousTabId(ids, 'missing')).toBe('missing');
  });

  it('タブが1枚も無ければそのまま返す', () => {
    expect(nextTabId([], 'a')).toBe('a');
    expect(previousTabId([], 'a')).toBe('a');
  });
});

// --- Issue #131: タブの見出しの出所 -----------------------------------------
//
// それまでタブは名前という属性を持たず、タブバーは tabLeaf（いま選んでいる
// ペイン）の title を借りていた。借り先が「今選んでいるペイン」なので、
// Cmd+] を押すたびに見出し・プロバイダ色・ツールチップ・ウィンドウ名が
// 同時に書き換わっていた。

describe('tabRepresentativeLeaf', () => {
  it('leaf 1枚の木では、その leaf を返す（tabLeaf と一致する）', () => {
    const t = tab();
    expect(tabRepresentativeLeaf(t)).toBe(tabLeaf(t));
  });

  it('**アクティブなペインがどれであっても、木の先頭 leaf を返す**', () => {
    const left = leaf({ paneId: 'left', ptyId: 'pty-left', title: '認証の調査', ptyKind: 'claude' });
    const right = leaf({ paneId: 'right', ptyId: 'pty-right', title: 'zsh' });
    const t = tab({ layout: splitRow([left, right]), activePaneId: 'right' });

    // tabLeaf は右（アクティブ）を返すが、代表は左のまま。
    expect(tabLeaf(t)).toBe(right);
    expect(tabRepresentativeLeaf(t)).toBe(left);
  });

  it('入れ子の分割でも、いちばん左上の leaf を返す', () => {
    const a = leaf({ paneId: 'a', ptyId: 'pty-a', title: 'A' });
    const b = leaf({ paneId: 'b', ptyId: 'pty-b', title: 'B' });
    const c = leaf({ paneId: 'c', ptyId: 'pty-c', title: 'C' });
    const t = tab({ layout: splitRow([splitRow([a, b]), c]), activePaneId: 'c' });
    expect(tabRepresentativeLeaf(t).title).toBe('A');
  });
});

describe('tabDisplayTitle', () => {
  it('タブ自身の名前が無ければ、木の先頭 leaf の title を出す（従来と同じ見え方）', () => {
    const t = tab({ layout: leaf({ title: 'my-repo' }) });
    expect(tabDisplayTitle(t)).toBe('my-repo');
  });

  it('タブ自身の名前があればそれを出す', () => {
    const t = tab({ layout: leaf({ title: 'my-repo' }), title: '認証まわり' });
    expect(tabDisplayTitle(t)).toBe('認証まわり');
  });

  it('**ペインを移っても見出しが変わらない**（この Issue が直した不具合そのもの）', () => {
    const left = leaf({ paneId: 'left', ptyId: 'pty-left', title: 'my-repo' });
    const right = leaf({ paneId: 'right', ptyId: 'pty-right', title: 'zsh' });
    const layout = splitRow([left, right]);
    const onLeft = tab({ layout, activePaneId: 'left' });
    const onRight = tab({ layout, activePaneId: 'right' });

    // tabLeaf 経由（旧実装）だと変わってしまうことを、対比として固定する。
    expect(tabLeaf(onLeft).title).not.toBe(tabLeaf(onRight).title);
    // tabDisplayTitle は変わらない。
    expect(tabDisplayTitle(onLeft)).toBe(tabDisplayTitle(onRight));
  });

  it('**名前を付けたタブは、先頭ペインを閉じても見出しが変わらない**（(b) 案の「ジャンプ」を防ぐ）', () => {
    const left = leaf({ paneId: 'left', ptyId: 'pty-left', title: 'my-repo' });
    const right = leaf({ paneId: 'right', ptyId: 'pty-right', title: 'zsh' });
    const before = tab({ layout: splitRow([left, right]), title: '認証まわり' });
    // 左（先頭 leaf）を閉じると、木は右 leaf 1枚に畳まれる。
    const after = tab({ layout: right, activePaneId: 'right', title: '認証まわり' });

    expect(tabDisplayTitle(before)).toBe('認証まわり');
    expect(tabDisplayTitle(after)).toBe('認証まわり');
  });

  it('名前を付けていないタブは、先頭ペインを閉じると導出先が繰り上がる（(d) を採る理由）', () => {
    const left = leaf({ paneId: 'left', ptyId: 'pty-left', title: 'my-repo' });
    const right = leaf({ paneId: 'right', ptyId: 'pty-right', title: 'zsh' });
    const before = tab({ layout: splitRow([left, right]) });
    const after = tab({ layout: right, activePaneId: 'right' });

    expect(tabDisplayTitle(before)).toBe('my-repo');
    expect(tabDisplayTitle(after)).toBe('zsh');
  });

  it('空文字・空白だけの名前は導出へ落とす（鉄則5）', () => {
    expect(tabDisplayTitle(tab({ layout: leaf({ title: 'my-repo' }), title: '' }))).toBe('my-repo');
    expect(tabDisplayTitle(tab({ layout: leaf({ title: 'my-repo' }), title: '   ' }))).toBe('my-repo');
  });
});

// Issue #142。タブの終了表示は「全 leaf が終了したときだけ」出す
// （確定仕様は .claude/workspace/issue-56/design-review.md:81）。
//
// それまで TabBar.tsx は tabLeaf(tab).exit（＝いま選んでいるペイン）を見ており、
// **every でも some でもない第三の挙動**だった。木の中身が1つも変わらないのに、
// Cmd+] でアクティブなペインを移しただけで終了表示が付いたり消えたりする。
//
// **some にしてはいけない**理由（TabBar.tsx のコメントが持つ）も、ここで型として
// 固定する: 状態スロットは終了を優先するので、some だと「あなたの番 + 隣が exit」の
// タブからあなたの番のドットが消える。下の「片方だけ終了」が false であることが
// その担保で、**この1本が some への退行に赤くなる**。
describe('tabAllPanesExited', () => {
  const exited = { exitCode: 0 };

  it('leaf 1枚: 終了していなければ false', () => {
    expect(tabAllPanesExited(leaf())).toBe(false);
  });

  it('leaf 1枚: 終了していれば true', () => {
    expect(tabAllPanesExited(leaf({ exit: exited }))).toBe(true);
  });

  it('分割2枚: どちらも生きていれば false', () => {
    const layout = splitRow([leaf({ paneId: 'a' }), leaf({ paneId: 'b' })]);
    expect(tabAllPanesExited(layout)).toBe(false);
  });

  it('分割2枚: 片方だけ終了なら false（some ではない）', () => {
    // **アクティブなペインがどちらかに関係なく false。** 第三の挙動
    // （tabLeaf(tab).exit）との差がここに出る。
    expect(tabAllPanesExited(splitRow([leaf({ paneId: 'a', exit: exited }), leaf({ paneId: 'b' })]))).toBe(
      false,
    );
    expect(tabAllPanesExited(splitRow([leaf({ paneId: 'a' }), leaf({ paneId: 'b', exit: exited })]))).toBe(
      false,
    );
  });

  it('分割2枚: 両方終了なら true', () => {
    const layout = splitRow([
      leaf({ paneId: 'a', exit: exited }),
      leaf({ paneId: 'b', exit: exited }),
    ]);
    expect(tabAllPanesExited(layout)).toBe(true);
  });

  it('入れ子の木: 3枚のうち1枚でも生きていれば false、全部終了なら true', () => {
    const alive = splitRow([
      leaf({ paneId: 'a', exit: exited }),
      splitRow([leaf({ paneId: 'b', exit: exited }), leaf({ paneId: 'c' })]),
    ]);
    expect(tabAllPanesExited(alive)).toBe(false);

    const allDead = splitRow([
      leaf({ paneId: 'a', exit: exited }),
      splitRow([leaf({ paneId: 'b', exit: exited }), leaf({ paneId: 'c', exit: exited })]),
    ]);
    expect(tabAllPanesExited(allDead)).toBe(true);
  });

  it('シグナルで終了した leaf も「終了」として数える', () => {
    // exit は { exitCode, signal? }。signal 付きでも undefined ではないので true。
    expect(tabAllPanesExited(leaf({ exit: { exitCode: 0, signal: 9 } }))).toBe(true);
  });

  it('exitCode 0 を falsy として取りこぼさない', () => {
    // `leaf.exit` は**オブジェクトの有無**で判定する。中身の exitCode が 0 でも
    // 「終了した」であって「終了していない」ではない。
    const layout = splitRow([
      leaf({ paneId: 'a', exit: { exitCode: 0 } }),
      leaf({ paneId: 'b', exit: { exitCode: 0 } }),
    ]);
    expect(tabAllPanesExited(layout)).toBe(true);
  });
});
