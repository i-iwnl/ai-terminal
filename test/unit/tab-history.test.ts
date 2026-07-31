// tabs/tabHistory.ts（Issue #20 PR 14「キーボード」）の単体テスト。
//
// Cmd+E（直前のタブへ戻る）の中核。「1つ前」を素朴に固定値で覚える実装だと、
// そのタブが閉じられていた場合に戻り先を失う。LRU 履歴 + 現存チェックで
// それを読み飛ばせることを固定する。

import { describe, expect, it } from 'vitest';
import { previousActiveTab, recordActiveTab, type TabHistory } from '../../src/renderer/src/tabs/tabHistory';

describe('recordActiveTab', () => {
  it('アクティブなタブを末尾に積む', () => {
    let history: TabHistory = [];
    history = recordActiveTab(history, 'a');
    history = recordActiveTab(history, 'b');
    expect(history).toEqual(['a', 'b']);
  });

  it('同じタブが連続する場合は積み直さない', () => {
    let history: TabHistory = recordActiveTab([], 'a');
    history = recordActiveTab(history, 'a');
    expect(history).toEqual(['a']);
  });

  it('既に履歴の途中にある id が再びアクティブになった場合、末尾へ積み直す（LRU）', () => {
    let history: TabHistory = ['a', 'b', 'c'];
    history = recordActiveTab(history, 'a');
    expect(history).toEqual(['b', 'c', 'a']);
  });

  it('null は無視する', () => {
    expect(recordActiveTab(['a'], null)).toEqual(['a']);
  });
});

describe('previousActiveTab', () => {
  it('末尾の1つ前のタブを返す', () => {
    const history: TabHistory = ['a', 'b'];
    expect(previousActiveTab(history, new Set(['a', 'b']))).toBe('a');
  });

  it('2回連続で呼ぶと直近2枚をトグルする想定の記録手順で正しく戻る', () => {
    // A が active（記録済み） -> Cmd+E で B へ -> 履歴は [A, B] のまま
    // （呼び出し側が recordActiveTab('B') を呼んだ結果）。
    let history: TabHistory = recordActiveTab([], 'a');
    const firstTarget = previousActiveTab(history, new Set(['a']));
    expect(firstTarget).toBeUndefined(); // まだ1枚しか記録が無い

    history = recordActiveTab(history, 'b');
    expect(previousActiveTab(history, new Set(['a', 'b']))).toBe('a');

    // もう一度アクティブ変更が記録されたとみなして a へ戻ったとする
    history = recordActiveTab(history, 'a');
    expect(previousActiveTab(history, new Set(['a', 'b']))).toBe('b');
  });

  // 閉じられて存在しなくなったタブは読み飛ばして、その前の生きているタブへ戻る。
  it('直前のタブが既に閉じられている場合、さらに前の生きているタブまで遡る', () => {
    const history: TabHistory = ['a', 'closed', 'c'];
    expect(previousActiveTab(history, new Set(['a', 'c']))).toBe('a');
  });

  it('履歴が1件以下なら undefined', () => {
    expect(previousActiveTab(['a'], new Set(['a']))).toBeUndefined();
    expect(previousActiveTab([], new Set())).toBeUndefined();
  });

  it('現存するタブが現在の1枚だけなら undefined', () => {
    const history: TabHistory = ['gone1', 'gone2', 'a'];
    expect(previousActiveTab(history, new Set(['a']))).toBeUndefined();
  });
});
