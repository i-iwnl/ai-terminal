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
  tabLeaf,
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
