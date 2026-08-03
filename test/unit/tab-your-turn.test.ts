// tabs/tabYourTurn.ts（Issue #20 PR 14「キーボード」）の単体テスト。
//
// Cmd+J（次の「あなたの番」のタブへジャンプ、Shift で逆順）の中核である
// findNextYourTurnTab を固定する。あなたの番 = busy 以外（src/shared/agent-status.ts
// の toTaskState が唯一の正）という対応を、ここで反転させていないことも併せて検証する。

import { describe, expect, it } from 'vitest';
import type { PaneLeaf, PaneNode, PaneSplit } from '../../src/renderer/src/tabs/paneTree';
import {
  findNextYourTurnTab,
  tabHasYourTurn,
  yourTurnSessionIds,
} from '../../src/renderer/src/tabs/tabYourTurn';

function leaf(overrides: Partial<PaneLeaf> = {}): PaneLeaf {
  return {
    kind: 'leaf',
    paneId: overrides.paneId ?? 'pane',
    ptyId: overrides.ptyId ?? 'pty',
    ptyKind: 'shell',
    title: 'zsh',
    ...overrides,
  };
}

function splitRow(children: [PaneNode, PaneNode]): PaneSplit {
  return { kind: 'split', dir: 'row', children, ratio: 0.5 };
}

/** 1タブ1ペイン、agentSessionId をそのままタブの目印にした最小の tab を作る。 */
function tab(id: string, agentSessionId?: string): { id: string; layout: PaneNode } {
  return { id, layout: leaf({ paneId: id, ptyId: id, agentSessionId }) };
}

describe('findNextYourTurnTab', () => {
  it('busy のタスクは「あなたの番」に数えない（idle だけを対象にする）', () => {
    const tabs = [tab('a', 'session-a'), tab('b', 'session-b')];
    const tasks = [
      { sessionId: 'session-a', status: 'busy' },
      { sessionId: 'session-b', status: 'idle' },
    ];
    expect(findNextYourTurnTab(tabs, 'a', tasks, 'forward')).toBe('b');
  });

  it('現在アクティブなタブの「次」から探索する（自分自身へは戻らない）', () => {
    const tabs = [tab('a', 'session-a'), tab('b', 'session-b'), tab('c', 'session-c')];
    // a 自身も「あなたの番」だが、a がアクティブな間に a へジャンプしても意味が無い。
    const tasks = [
      { sessionId: 'session-a', status: 'idle' },
      { sessionId: 'session-b', status: 'busy' },
      { sessionId: 'session-c', status: 'idle' },
    ];
    expect(findNextYourTurnTab(tabs, 'a', tasks, 'forward')).toBe('c');
  });

  it('末尾まで見つからなければ先頭へ折り返す（環状）', () => {
    const tabs = [tab('a', 'session-a'), tab('b', 'session-b'), tab('c', 'session-c')];
    const tasks = [{ sessionId: 'session-a', status: 'idle' }];
    // b がアクティブ: 次は c（対象外）、折り返して a（あなたの番）
    expect(findNextYourTurnTab(tabs, 'b', tasks, 'forward')).toBe('a');
  });

  it('Shift（backward）は逆順に探索する', () => {
    const tabs = [tab('a', 'session-a'), tab('b', 'session-b'), tab('c', 'session-c')];
    const tasks = [{ sessionId: 'session-a', status: 'idle' }];
    // c がアクティブ: 前は b（対象外）、さらに前で a（あなたの番）
    expect(findNextYourTurnTab(tabs, 'c', tasks, 'backward')).toBe('a');
  });

  it('「あなたの番」のタブが1つも無ければ undefined を返す', () => {
    const tabs = [tab('a', 'session-a'), tab('b', 'session-b')];
    const tasks = [
      { sessionId: 'session-a', status: 'busy' },
      { sessionId: 'session-b', status: 'busy' },
    ];
    expect(findNextYourTurnTab(tabs, 'a', tasks, 'forward')).toBeUndefined();
  });

  it('タスクが1件も無ければ undefined を返す', () => {
    const tabs = [tab('a', 'session-a')];
    expect(findNextYourTurnTab(tabs, 'a', [], 'forward')).toBeUndefined();
  });

  it('タブが1枚も無ければ undefined を返す', () => {
    expect(findNextYourTurnTab([], null, [{ sessionId: 'x', status: 'idle' }], 'forward')).toBeUndefined();
  });

  it('シェルタブ（agentSessionId 無し）は対象にしない', () => {
    const tabs = [tab('shell'), tab('claude', 'session-claude')];
    const tasks = [{ sessionId: 'session-claude', status: 'idle' }];
    expect(findNextYourTurnTab(tabs, 'shell', tasks, 'forward')).toBe('claude');
  });

  // Issue #56 PR 4 と同じ理由: 分割後、あなたの番のエージェントが非アクティブな
  // ペインで動いていてもタブ自体はジャンプ対象に含める（findTabByAgentSessionId
  // と同じ考え方）。
  it('分割したタブで、非アクティブな leaf の agentSessionId でもジャンプ対象になる', () => {
    const shellLeaf = leaf({ paneId: 'shell', ptyId: 'pty-shell' });
    const claudeLeaf = leaf({
      paneId: 'claude',
      ptyId: 'pty-claude',
      ptyKind: 'claude',
      agentSessionId: 'session-background',
    });
    const split: { id: string; layout: PaneNode } = {
      id: 'tab-split',
      layout: splitRow([shellLeaf, claudeLeaf]),
    };
    const other = tab('other');
    const tasks = [{ sessionId: 'session-background', status: 'idle' }];
    expect(findNextYourTurnTab([other, split], 'other', tasks, 'forward')).toBe('tab-split');
  });

  it('activeTabId が現在のタブ一覧に無い（削除された等）場合も先頭から探索する', () => {
    const tabs = [tab('a', 'session-a'), tab('b', 'session-b')];
    const tasks = [{ sessionId: 'session-b', status: 'idle' }];
    expect(findNextYourTurnTab(tabs, 'gone', tasks, 'forward')).toBe('b');
  });
});

describe('tabHasYourTurn（Issue #119 周5: タブバーの状態スロット）', () => {
  // Cmd+J（findNextYourTurnTab）とタブバーのドットが、**同じ判定**を使うことが
  // この関数を切り出した理由。片方だけ独自に status を解釈すると、
  // 「Cmd+J は飛ぶのにドットが出ていない」という食い違いが起きる。

  it('あなたの番のタスクが0件なら false', () => {
    expect(tabHasYourTurn(leaf({ agentSessionId: 's1' }), yourTurnSessionIds([]))).toBe(false);
    expect(
      tabHasYourTurn(
        leaf({ agentSessionId: 's1' }),
        yourTurnSessionIds([{ sessionId: 's1', status: 'busy' }]),
      ),
    ).toBe(false);
  });

  it('busy 以外（= あなたの番）なら true', () => {
    // 状態の意味の正は shared/agent-status.ts の toTaskState。反転させない。
    const ids = yourTurnSessionIds([{ sessionId: 's1', status: 'idle' }]);
    expect(tabHasYourTurn(leaf({ agentSessionId: 's1' }), ids)).toBe(true);
  });

  it('status が未知の値のときはドットを出さない（第3の状態として扱う）', () => {
    // **`toTaskState` は二値分岐ではない。** `busy` -> working、`idle` -> your-turn、
    // **それ以外は unknown** で、`countYourTurn` も Dock バッジも unknown を数えない
    // （「分からないものを人間の番として催促しない」）。
    //
    // タブバーのドットも同じ扱いにする。ここで unknown を「あなたの番」に寄せると、
    // **CLI が新しい status を返し始めた日から全タブに橙のドットが出る**。
    // タスク一覧（unknown グループ + 生の値を併記）とも食い違う。
    const ids = yourTurnSessionIds([{ sessionId: 's1', status: 'waiting_for_input' }]);
    expect(tabHasYourTurn(leaf({ agentSessionId: 's1' }), ids)).toBe(false);
    // status そのものが無いときも同じ。
    expect(
      tabHasYourTurn(leaf({ agentSessionId: 's1' }), yourTurnSessionIds([{ sessionId: 's1' }])),
    ).toBe(false);
  });

  it('分割中は、非アクティブなペインで待っていてもタブには印が出る', () => {
    // タブは畳まれた木の代表なので、中のどれかが待っていれば待っている
    // （findNextYourTurnTab と同じ考え方）。
    const split: PaneNode = {
      kind: 'split',
      dir: 'row',
      ratio: 0.5,
      children: [leaf({ paneId: 'a' }), leaf({ paneId: 'b', agentSessionId: 's2' })],
    } as PaneSplit;
    const ids = yourTurnSessionIds([{ sessionId: 's2', status: 'idle' }]);
    expect(tabHasYourTurn(split, ids)).toBe(true);
  });

  it('agentSessionId を持たないペイン（シェルタブ）だけなら false', () => {
    const ids = yourTurnSessionIds([{ sessionId: 's1', status: 'idle' }]);
    expect(tabHasYourTurn(leaf({ paneId: 'a' }), ids)).toBe(false);
  });
});
