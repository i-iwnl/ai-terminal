// tabs/tabYourTurn.ts（Issue #20 PR 14「キーボード」）の単体テスト。
//
// Cmd+J（次の「あなたの番」の**ペイン**へジャンプ、Shift で逆順）の中核である
// findNextYourTurnPane を固定する。**Issue #132 でタブ粒度からペイン粒度へ変えた**
// （タブを前に出すだけだと、分割しているタブでは裏のペインに居る claude に
// 入力できない = タブ止まり）。あなたの番 = busy 以外（src/shared/agent-status.ts
// の toTaskState が唯一の正）という対応を、ここで反転させていないことも併せて検証する。

import { describe, expect, it } from 'vitest';
import type { PaneLeaf, PaneNode, PaneSplit } from '../../src/renderer/src/tabs/paneTree';
import {
  findNextYourTurnPane,
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

describe('findNextYourTurnPane', () => {
  it('busy のタスクは「あなたの番」に数えない（idle だけを対象にする）', () => {
    const tabs = [tab('a', 'session-a'), tab('b', 'session-b')];
    const tasks = [
      { sessionId: 'session-a', status: 'busy' },
      { sessionId: 'session-b', status: 'idle' },
    ];
    expect(findNextYourTurnPane(tabs, 'a', 'a', tasks, 'forward')).toEqual({
      tabId: 'b',
      paneId: 'b',
    });
  });

  it('いま見ているペインの「次」から探索する（自分自身へは戻らない）', () => {
    const tabs = [tab('a', 'session-a'), tab('b', 'session-b'), tab('c', 'session-c')];
    // a 自身も「あなたの番」だが、a を見ている間に a へジャンプしても意味が無い。
    const tasks = [
      { sessionId: 'session-a', status: 'idle' },
      { sessionId: 'session-b', status: 'busy' },
      { sessionId: 'session-c', status: 'idle' },
    ];
    expect(findNextYourTurnPane(tabs, 'a', 'a', tasks, 'forward')).toEqual({
      tabId: 'c',
      paneId: 'c',
    });
  });

  it('末尾まで見つからなければ先頭へ折り返す（環状）', () => {
    const tabs = [tab('a', 'session-a'), tab('b', 'session-b'), tab('c', 'session-c')];
    const tasks = [{ sessionId: 'session-a', status: 'idle' }];
    // b を見ている: 次は c（対象外）、折り返して a（あなたの番）
    expect(findNextYourTurnPane(tabs, 'b', 'b', tasks, 'forward')).toEqual({
      tabId: 'a',
      paneId: 'a',
    });
  });

  it('Shift（backward）は逆順に探索する', () => {
    const tabs = [tab('a', 'session-a'), tab('b', 'session-b'), tab('c', 'session-c')];
    const tasks = [{ sessionId: 'session-a', status: 'idle' }];
    // c を見ている: 前は b（対象外）、さらに前で a（あなたの番）
    expect(findNextYourTurnPane(tabs, 'c', 'c', tasks, 'backward')).toEqual({
      tabId: 'a',
      paneId: 'a',
    });
  });

  it('「あなたの番」のペインが1つも無ければ undefined を返す', () => {
    const tabs = [tab('a', 'session-a'), tab('b', 'session-b')];
    const tasks = [
      { sessionId: 'session-a', status: 'busy' },
      { sessionId: 'session-b', status: 'busy' },
    ];
    expect(findNextYourTurnPane(tabs, 'a', 'a', tasks, 'forward')).toBeUndefined();
  });

  it('タスクが1件も無ければ undefined を返す', () => {
    const tabs = [tab('a', 'session-a')];
    expect(findNextYourTurnPane(tabs, 'a', 'a', [], 'forward')).toBeUndefined();
  });

  it('タブが1枚も無ければ undefined を返す', () => {
    expect(
      findNextYourTurnPane([], null, null, [{ sessionId: 'x', status: 'idle' }], 'forward'),
    ).toBeUndefined();
  });

  it('シェルペイン（agentSessionId 無し）は対象にしない', () => {
    const tabs = [tab('shell'), tab('claude', 'session-claude')];
    const tasks = [{ sessionId: 'session-claude', status: 'idle' }];
    expect(findNextYourTurnPane(tabs, 'shell', 'shell', tasks, 'forward')).toEqual({
      tabId: 'claude',
      paneId: 'claude',
    });
  });

  // --- Issue #132 の本体: 着地点がペインであること -----------------------------

  it('**分割したタブでは、待っている leaf の paneId を返す**（タブ止まりにしない）', () => {
    // これが #132 そのもの。タブ粒度のままだと `tab-split` しか返せず、
    // 呼び出し側は setActiveTabId しかできない。すると**アクティブなペインは
    // shell のまま**で、飛んだ先で claude に入力できない。
    const shellLeaf = leaf({ paneId: 'shell', ptyId: 'pty-shell' });
    const claudeLeaf = leaf({
      paneId: 'claude',
      ptyId: 'pty-claude',
      ptyKind: 'claude',
      agentSessionId: 'session-background',
    });
    const split = { id: 'tab-split', layout: splitRow([shellLeaf, claudeLeaf]) };
    const other = tab('other');
    const tasks = [{ sessionId: 'session-background', status: 'idle' }];
    expect(findNextYourTurnPane([other, split], 'other', 'other', tasks, 'forward')).toEqual({
      tabId: 'tab-split',
      paneId: 'claude',
    });
  });

  it('**タブが1枚しか無くても、別のペインへ動く**（タブ粒度では no-op だった）', () => {
    // タブ単位の探索は `(startIndex + step * i) % length` を回すので、
    // タブが1枚だと1周目で自分自身に戻り、setActiveTabId が no-op になっていた。
    // 「1タブを分割して片方が待っている」は分割の主用途そのもの。
    const shellLeaf = leaf({ paneId: 'shell', ptyId: 'pty-shell' });
    const claudeLeaf = leaf({
      paneId: 'claude',
      ptyId: 'pty-claude',
      ptyKind: 'claude',
      agentSessionId: 'session-here',
    });
    const only = { id: 'only', layout: splitRow([shellLeaf, claudeLeaf]) };
    const tasks = [{ sessionId: 'session-here', status: 'idle' }];
    expect(findNextYourTurnPane([only], 'only', 'shell', tasks, 'forward')).toEqual({
      tabId: 'only',
      paneId: 'claude',
    });
  });

  it('いま見ているペインだけが「あなたの番」なら undefined（1周して自分に戻る）', () => {
    const shellLeaf = leaf({ paneId: 'shell', ptyId: 'pty-shell' });
    const claudeLeaf = leaf({
      paneId: 'claude',
      ptyId: 'pty-claude',
      ptyKind: 'claude',
      agentSessionId: 'session-here',
    });
    const only = { id: 'only', layout: splitRow([shellLeaf, claudeLeaf]) };
    const tasks = [{ sessionId: 'session-here', status: 'idle' }];
    // 既に claude ペインを見ている -> 他に候補が無い
    expect(findNextYourTurnPane([only], 'only', 'claude', tasks, 'forward')).toBeUndefined();
  });

  it('同じタブに待っているペインが2枚あれば、木の順で次の1枚を返す', () => {
    const a = leaf({ paneId: 'p1', ptyId: 'pty1', ptyKind: 'claude', agentSessionId: 's1' });
    const b = leaf({ paneId: 'p2', ptyId: 'pty2', ptyKind: 'claude', agentSessionId: 's2' });
    const t = { id: 't', layout: splitRow([a, b]) };
    const tasks = [
      { sessionId: 's1', status: 'idle' },
      { sessionId: 's2', status: 'idle' },
    ];
    expect(findNextYourTurnPane([t], 't', 'p1', tasks, 'forward')).toEqual({
      tabId: 't',
      paneId: 'p2',
    });
    // 逆順では折り返して p1 へ戻る（環状）。
    expect(findNextYourTurnPane([t], 't', 'p2', tasks, 'backward')).toEqual({
      tabId: 't',
      paneId: 'p1',
    });
  });

  it('activeTabId / activePaneId が現在の一覧に無い（削除された等）場合も先頭から探索する', () => {
    const tabs = [tab('a', 'session-a'), tab('b', 'session-b')];
    const tasks = [{ sessionId: 'session-a', status: 'idle' }];
    // 先頭（a）が最初の候補になる。
    expect(findNextYourTurnPane(tabs, 'gone', 'gone', tasks, 'forward')).toEqual({
      tabId: 'a',
      paneId: 'a',
    });
  });
});

describe('tabHasYourTurn（Issue #119 周5: タブバーの状態スロット）', () => {
  // Cmd+J（findNextYourTurnPane）とタブバーのドットが、**同じ判定**を使うことが
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
    // （findNextYourTurnPane と同じ考え方。ただしあちらは
    // **どの leaf か**まで返す。ここは「そのタブが待っているか」だけでよい）。
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
