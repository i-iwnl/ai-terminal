// tabs/tabPane.ts（Issue #56 PR 3）の単体テスト。
//
// PTY のメタ（ptyId / kind / title / agentSessionId / cwd / exit）を leaf に
// 持たせたことで生まれた、TabState から leaf を引く経路を固定する
// （design-review.md Q4）。PR 3 の時点では木は常に leaf 1枚。

import { describe, expect, it } from 'vitest';
import type { PaneLeaf } from '../../src/renderer/src/tabs/paneTree';
import {
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

function tab(overrides: Partial<TabState> & { layout?: PaneLeaf } = {}): TabState {
  const layout = overrides.layout ?? leaf();
  return {
    id: layout.ptyId,
    layout,
    activePaneId: layout.paneId,
    createdAt: 0,
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
});
