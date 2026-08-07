// `claude agents --json` のタスクと、生きている tmux セッションの突き合わせ
// （`src/main/agents/sessionMatch.ts`）。
//
// **このファイルが守るのは「押せないゾンビ行」の再発防止。**
// `claude` は CLI 内の `/resume` や `/clear` で自分の sessionId を切り替えるため、
// UUID だけで突き合わせると、その瞬間に `ownedByApp` / `recoverable` / タブの照合 /
// 重複排除が**同時に全部外れる**。実機で観測した形をそのまま最初のテストにしてある。

import { describe, expect, it } from 'vitest';
import { resolveAppSessionIds } from '../../src/main/agents/sessionMatch';

/** 実機で観測した乖離（2026-08-07）。argv は 119a69f7… なのに CLI は 1adde719… と報告した。 */
const DIVERGED_TASK = { sessionId: '1adde719-be15-4ca5-bc2b-35f897cbb549', pid: 60756 };
const DIVERGED_SESSION = { agentSessionId: '119a69f7-8f5d-44b9-b00b-cb3866f8be60', panePid: 60756 };

describe('resolveAppSessionIds', () => {
  it('sessionId が乖離していても pid で tmux セッションに辿り着く（実機で観測した形）', () => {
    const resolved = resolveAppSessionIds([DIVERGED_TASK], [DIVERGED_SESSION]);
    expect(resolved.get(DIVERGED_TASK.sessionId)).toBe(DIVERGED_SESSION.agentSessionId);
  });

  it('UUID が一致していればそのまま解決する', () => {
    const resolved = resolveAppSessionIds(
      [{ sessionId: 'aaa', pid: 1 }],
      [{ agentSessionId: 'aaa', panePid: 1 }],
    );
    expect(resolved.get('aaa')).toBe('aaa');
  });

  it('生きている tmux セッションが無ければ解決しない（= 押せない行のまま）', () => {
    const resolved = resolveAppSessionIds([DIVERGED_TASK], []);
    expect(resolved.has(DIVERGED_TASK.sessionId)).toBe(false);
  });

  it('アプリ外で起動された claude は解決しない（pid も名前も一致しない）', () => {
    const resolved = resolveAppSessionIds(
      [{ sessionId: 'outside', pid: 999 }],
      [DIVERGED_SESSION],
    );
    expect(resolved.has('outside')).toBe(false);
  });

  describe('UUID 一致を pid 一致より先に確定する', () => {
    it('pid が食い違っていても、UUID が一致するほうを採る', () => {
      // tmux 側の pane_pid が古い（ペイン内でプロセスが入れ替わった等）ケース。
      const resolved = resolveAppSessionIds(
        [{ sessionId: 'aaa', pid: 100 }],
        [{ agentSessionId: 'aaa', panePid: 777 }],
      );
      expect(resolved.get('aaa')).toBe('aaa');
    });

    it('UUID で確定した tmux セッションを、別のタスクが pid で横取りしない', () => {
      const tasks = [
        { sessionId: 'aaa', pid: 100 }, // UUID 一致
        { sessionId: 'zzz', pid: 500 }, // pid が aaa のセッションと同じ
      ];
      const live = [{ agentSessionId: 'aaa', panePid: 500 }];
      const resolved = resolveAppSessionIds(tasks, live);
      expect(resolved.get('aaa')).toBe('aaa');
      expect(resolved.has('zzz')).toBe(false);
    });
  });

  describe('pid が無いときに取り違えない', () => {
    it('pid が undefined のタスクは pid 一致の対象にしない', () => {
      const resolved = resolveAppSessionIds(
        [{ sessionId: 'nopid' }],
        [{ agentSessionId: 'live-1', panePid: 60756 }],
      );
      expect(resolved.has('nopid')).toBe(false);
    });

    it('panePid が undefined の tmux セッションには pid で当たらない', () => {
      const resolved = resolveAppSessionIds(
        [{ sessionId: 'task-1', pid: 60756 }],
        [{ agentSessionId: 'live-1' }],
      );
      expect(resolved.has('task-1')).toBe(false);
    });

    it('pid も panePid も無い組み合わせで、undefined 同士が一致しない', () => {
      const resolved = resolveAppSessionIds([{ sessionId: 'task-1' }], [{ agentSessionId: 'live-1' }]);
      expect(resolved.size).toBe(0);
    });
  });

  describe('1本の tmux セッションを2つのタスクが取り合わない', () => {
    it('同じ pid のタスクが2つ来たら先勝ちにする', () => {
      const resolved = resolveAppSessionIds(
        [
          { sessionId: 'first', pid: 60756 },
          { sessionId: 'second', pid: 60756 },
        ],
        [DIVERGED_SESSION],
      );
      expect(resolved.get('first')).toBe(DIVERGED_SESSION.agentSessionId);
      expect(resolved.has('second')).toBe(false);
    });

    it('同じ panePid の tmux セッションが2本来たら先勝ちにする', () => {
      const resolved = resolveAppSessionIds(
        [{ sessionId: 'task-1', pid: 42 }],
        [
          { agentSessionId: 'live-a', panePid: 42 },
          { agentSessionId: 'live-b', panePid: 42 },
        ],
      );
      expect(resolved.get('task-1')).toBe('live-a');
    });
  });

  describe('複数件が混ざっても取り違えない', () => {
    it('乖離した1件と、一致している1件と、アプリ外の1件を同時に正しく捌く', () => {
      const tasks = [
        DIVERGED_TASK,
        { sessionId: '849c9398-8290-45db-a2dd-fafc562b6ce8', pid: 33037 },
        { sessionId: 'outside-app', pid: 14616 },
      ];
      const live = [
        DIVERGED_SESSION,
        { agentSessionId: '849c9398-8290-45db-a2dd-fafc562b6ce8', panePid: 33037 },
      ];
      const resolved = resolveAppSessionIds(tasks, live);
      expect(resolved.get(DIVERGED_TASK.sessionId)).toBe(DIVERGED_SESSION.agentSessionId);
      expect(resolved.get('849c9398-8290-45db-a2dd-fafc562b6ce8')).toBe(
        '849c9398-8290-45db-a2dd-fafc562b6ce8',
      );
      expect(resolved.has('outside-app')).toBe(false);
      expect(resolved.size).toBe(2);
    });
  });

  it('空の入力で落ちない', () => {
    expect(resolveAppSessionIds([], []).size).toBe(0);
  });
});
