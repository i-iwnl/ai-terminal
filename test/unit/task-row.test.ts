// タスク一覧の行が押せるかの判定（#180 周12 / 2026-08-06）。
//
// **これが不具合の本体だった。** 以前は「そのセッションを開いているタブがあるか」
// だけを見ていたが、タブの構成はどこにも永続化していないので、**アプリを再起動した
// 瞬間、走っているセッションは全部「一覧には出るが押せない行」になっていた。**
// 一覧には「このアプリ」バッジ付きで出ているのに、そこからは戻れない。

import { describe, expect, it } from 'vitest';
import {
  liveSessionDisplayName,
  liveSessionProviderLabel,
  resolveTaskRowAction,
  selectRecoverableSessions,
  taskRowActionLabel,
} from '../../src/renderer/src/sidebar/taskRow';

const owned = { ownedByApp: true };

describe('resolveTaskRowAction', () => {
  it('タブが開いていれば、そのタブへ移動する', () => {
    expect(resolveTaskRowAction({ ...owned, recoverable: false }, true)).toBe('focus');
  });

  // ⭐ この周の本体。ここが 'none' に戻ると「押せない死に行」が復活する。
  it('タブが無くても tmux セッションが生きていれば戻せる', () => {
    expect(resolveTaskRowAction({ ...owned, recoverable: true }, false)).toBe('recover');
  });

  // ⛔ 未取得（undefined）を「押せる」側に倒さない。倒すと押した先で新しいプロセスが生える。
  it('recoverable が未取得なら押せない（肯定条件でしか採らない）', () => {
    expect(resolveTaskRowAction({ ownedByApp: true }, false)).toBe('none');
  });

  // ⭐ **ここが実機で覆った所。** `ownedByApp` は Main のメモリ上の Set で、
  // アプリを再起動すると空になる。条件にすると「再起動して見失った」場面で
  // 一度も true にならず、この関数が何も直さなくなる。
  // tmux 名 `aiterm-<id>` を付けるのはこのアプリだけなので、
  // **その名前で生きていること自体が「このアプリが起動した」の証拠**。
  it('ownedByApp が落ちていても、tmux が生きていれば戻せる（再起動後の主要な経路）', () => {
    expect(resolveTaskRowAction({ ownedByApp: false, recoverable: true }, false)).toBe('recover');
  });

  it('tmux にも居なければ、ownedByApp に関わらず押せない', () => {
    expect(resolveTaskRowAction({ ownedByApp: false, recoverable: false }, false)).toBe('none');
    expect(resolveTaskRowAction({ ownedByApp: true, recoverable: false }, false)).toBe('none');
  });

  // タブがあるときは移動が優先。戻す（新しいタブを開く）に倒すと二重に開く。
  it('タブがあり tmux も生きているときは、移動が優先される', () => {
    expect(resolveTaskRowAction({ ...owned, recoverable: true }, true)).toBe('focus');
  });
});

describe('taskRowActionLabel', () => {
  it('押したときに何が起きるかを言い分ける', () => {
    expect(taskRowActionLabel('focus')).toBe('開いているタブへ移動');
    expect(taskRowActionLabel('recover')).toBe('タブに戻す');
  });

  it('押せない行には何も足さない', () => {
    expect(taskRowActionLabel('none')).toBeUndefined();
  });

  // ⛔ 「回収」は内部語。画面にも読み上げにも出さない。
  it('内部語（回収）を画面へ出さない', () => {
    for (const action of ['focus', 'recover', 'none'] as const) {
      expect(taskRowActionLabel(action) ?? '').not.toContain('回収');
    }
  });
});

// 「タブに戻せる AI」の節に何を出すか（#180 周13 PR 3）。
describe('selectRecoverableSessions', () => {
  const live = [
    { agentSessionId: 'a', provider: 'claude' as const },
    { agentSessionId: 'b', provider: 'gemini' as const },
    { agentSessionId: 'c', provider: 'gemini' as const },
  ];

  // 上の状態グループに既に出ているものを、この節にも出すと二重になる。
  it('タスク一覧に既にある行は出さない', () => {
    expect(
      selectRecoverableSessions(live, new Set(['a']), new Set()).map((s) => s.agentSessionId),
    ).toEqual(['b', 'c']);
  });

  it('いまタブが開いているものは出さない（そこへ行けばよい）', () => {
    expect(
      selectRecoverableSessions(live, new Set(), new Set(['b'])).map((s) => s.agentSessionId),
    ).toEqual(['a', 'c']);
  });

  it('両方に該当するものも1回だけ落ちる', () => {
    expect(
      selectRecoverableSessions(live, new Set(['a']), new Set(['a', 'b'])).map(
        (s) => s.agentSessionId,
      ),
    ).toEqual(['c']);
  });

  // ⭐ gemini はタスク一覧に1件も出ないので、全部ここに残るのが正しい。
  it('gemini は素通しで残る（タスク一覧に出ないため）', () => {
    const geminis = live.filter((s) => s.provider === 'gemini');
    expect(selectRecoverableSessions(geminis, new Set(), new Set())).toEqual(geminis);
  });

  it('全部出ていれば空になる（節ごと消える）', () => {
    expect(selectRecoverableSessions(live, new Set(['a', 'b', 'c']), new Set())).toEqual([]);
  });
});

describe('liveSessionDisplayName / liveSessionProviderLabel', () => {
  // ⛔ pane_title を使わない（`✳` は機種依存文字で、内容によって毎秒変わる）。
  it('セッション ID の先頭8桁で名乗る（既存の言い回しに合わせる）', () => {
    expect(liveSessionDisplayName('36ad708d-8af3-4c0f-a4b7-6ce4c5a87bc2')).toBe(
      'セッション 36ad708d',
    );
  });

  it('プロバイダは語で出す（色で分けない）', () => {
    expect(liveSessionProviderLabel('claude')).toBe('Claude');
    expect(liveSessionProviderLabel('gemini')).toBe('Gemini');
  });
});
