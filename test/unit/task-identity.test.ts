// 前回・今回のポーリング結果を突き合わせるキー。
// `sessionId` が一意でないこと（CLI 内の /resume）を前提にした設計を固定する。

import { describe, expect, it } from 'vitest';

import { indexByIdentity, taskIdentity } from '../../src/main/agents/taskIdentity';

describe('taskIdentity', () => {
  it('pid があれば pid を使う（sessionId が /resume で変わっても同じキーになる）', () => {
    expect(taskIdentity({ sessionId: 'before', pid: 42 })).toBe(
      taskIdentity({ sessionId: 'after', pid: 42 }),
    );
  });

  it('同じ sessionId でも pid が違えば別のキーになる', () => {
    expect(taskIdentity({ sessionId: 'dup', pid: 1 })).not.toBe(
      taskIdentity({ sessionId: 'dup', pid: 2 })
    );
  });

  it('pid が無ければ sessionId へ落ちる', () => {
    expect(taskIdentity({ sessionId: 'a' })).toBe('session:a');
  });

  it('pid 由来のキーは sessionId と衝突しない', () => {
    // 衝突すると別プロセスが同じキーへ畳まれ、この関数を入れた意味が消える。
    expect(taskIdentity({ sessionId: 'pid:42' })).not.toBe(taskIdentity({ sessionId: 'x', pid: 42 }));
  });

  it('pid の無いものどうしを同じキーにまとめない', () => {
    // sessionMatch.ts と同じ落とし穴（undefined === undefined で全部が1本に吸い寄せられる）。
    expect(taskIdentity({ sessionId: 'a' })).not.toBe(taskIdentity({ sessionId: 'b' }));
  });
});

describe('indexByIdentity', () => {
  it('キーで引ける索引を作る', () => {
    const index = indexByIdentity([
      { sessionId: 'a', pid: 1 },
      { sessionId: 'b', pid: 2 },
    ]);

    expect(index.get('pid:1')?.sessionId).toBe('a');
    expect(index.get('pid:2')?.sessionId).toBe('b');
  });

  it('キーが重複したものは索引に入れない（後勝ちにしない）', () => {
    // Map の後勝ちに任せると、比較相手が配列の並び順で決まる。
    // それが Issue #241 の無限ループの直接の原因だった。
    const index = indexByIdentity([
      { sessionId: 'dup', status: 'waiting' },
      { sessionId: 'dup', status: 'busy' },
    ]);

    expect(index.has('session:dup')).toBe(false);
  });

  it('重複していないものは、重複があっても巻き添えにしない', () => {
    const index = indexByIdentity([
      { sessionId: 'dup' },
      { sessionId: 'dup' },
      { sessionId: 'ok' },
    ]);

    expect(index.has('session:dup')).toBe(false);
    expect(index.has('session:ok')).toBe(true);
  });
});
