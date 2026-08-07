// claude agents --json の status を、人間から見た意味へ翻訳する判定。
//
// 表示（TaskList）・通知（poller）・Dock バッジの3箇所がこの1つの実装を共有する。
// ここが壊れると「UI は不明と出すが通知は作業完了と言う」ような食い違いが生まれる。

import { describe, expect, it } from 'vitest';
import {
  toTaskState,
  countYourTurn,
  becameYourTurn,
  groupTasksForDisplay,
  formatGroupHeading,
  describeWaitingFor,
  TASK_STATE_LABEL,
} from '../../src/shared/agent-status';

describe('toTaskState', () => {
  it('CLI の語と人間から見た意味が逆であることを固定する', () => {
    // busy = エージェントが動いている = 人間は待たなくてよい
    expect(toTaskState('busy')).toBe('working');
    // idle = エージェントが止まっている = あなたの番
    expect(toTaskState('idle')).toBe('your-turn');
  });

  it('未知の値を既知の2値に丸めない', () => {
    // 二値分岐にすると、CLI が新しい語を返し始めた瞬間に全件が片側へ誤訳される
    expect(toTaskState('waiting_for_input')).toBe('unknown');
    expect(toTaskState('')).toBe('unknown');
    expect(toTaskState(undefined)).toBe('unknown');
  });

  it('ラベルは3状態すべてに用意されている', () => {
    expect(TASK_STATE_LABEL.working).toBe('作業中');
    expect(TASK_STATE_LABEL['your-turn']).toBe('あなたの番');
    expect(TASK_STATE_LABEL.unknown).toBe('不明');
  });
});

describe('countYourTurn', () => {
  it('あなたの番だけを数える', () => {
    expect(
      countYourTurn([{ status: 'idle' }, { status: 'busy' }, { status: 'idle' }]),
    ).toBe(2);
  });

  it('未知の状態は数えない', () => {
    // 分からないものを「あなたの番」として Dock バッジで催促しない
    expect(countYourTurn([{ status: 'waiting_for_input' }, { status: undefined }])).toBe(0);
  });

  it('空配列は 0', () => {
    expect(countYourTurn([])).toBe(0);
  });
});

describe('becameYourTurn', () => {
  it('作業中から抜けた遷移だけを true にする', () => {
    expect(becameYourTurn('busy', 'idle')).toBe(true);
    // 一覧から消えた（プロセスが終わった）場合も「作業中でなくなった」に数える
    expect(becameYourTurn('busy', undefined)).toBe(true);
  });

  it('作業中のままなら false', () => {
    expect(becameYourTurn('busy', 'busy')).toBe(false);
  });

  it('もともと作業中でなければ false', () => {
    // idle -> idle で毎回通知が飛ぶと、ポーリングのたびに鳴り続ける
    expect(becameYourTurn('idle', 'idle')).toBe(false);
    expect(becameYourTurn(undefined, 'idle')).toBe(false);
  });

  it('未知の語への遷移も「作業が終わった」側に数える', () => {
    // 通知が来ないことには気づけないので、迷ったら通知する側に倒す
    expect(becameYourTurn('busy', 'waiting_for_input')).toBe(true);
  });
});

describe('groupTasksForDisplay', () => {
  it('「あなたの番」を先頭、次に「作業中」、未知の状態は末尾にする', () => {
    // CLI が返した順（working, unknown, your-turn）のままでは、あなたの番が
    // 一覧の下に沈む。ここを並べ替えるのが groupTasksForDisplay の役目。
    const tasks = [
      { status: 'busy', sessionId: 'w1' },
      { status: 'weird', sessionId: 'u1' },
      { status: 'idle', sessionId: 'y1' },
    ];
    const groups = groupTasksForDisplay(tasks);
    expect(groups.map((g) => g.state)).toEqual(['your-turn', 'working', 'unknown']);
    expect(groups[0].tasks.map((t) => t.sessionId)).toEqual(['y1']);
    expect(groups[1].tasks.map((t) => t.sessionId)).toEqual(['w1']);
    expect(groups[2].tasks.map((t) => t.sessionId)).toEqual(['u1']);
  });

  it('未知の状態を「あなたの番」グループに混ぜない', () => {
    // CLI が waiting_for_input のような新しい値を返し始めても、
    // 「あなたの番」の件数・グループに紛れ込ませない（誤って人間を急かさない）。
    const groups = groupTasksForDisplay([{ status: 'waiting_for_input', sessionId: 'u1' }]);
    expect(groups).toEqual([{ state: 'unknown', tasks: [{ status: 'waiting_for_input', sessionId: 'u1' }] }]);
  });

  it('タスクが1件も無いグループは結果から除く', () => {
    const groups = groupTasksForDisplay([{ status: 'busy', sessionId: 'w1' }]);
    expect(groups).toEqual([{ state: 'working', tasks: [{ status: 'busy', sessionId: 'w1' }] }]);
  });

  it('空配列は空配列を返す', () => {
    expect(groupTasksForDisplay([])).toEqual([]);
  });

  it('「あなたの番」グループ内は、待たせている時間が長い順（yourTurnSince が古い順）に並ぶ', () => {
    const tasks = [
      { status: 'idle', sessionId: 'recent', yourTurnSince: 300 },
      { status: 'idle', sessionId: 'oldest', yourTurnSince: 100 },
      { status: 'idle', sessionId: 'middle', yourTurnSince: 200 },
    ];
    const groups = groupTasksForDisplay(tasks);
    expect(groups[0].tasks.map((t) => t.sessionId)).toEqual(['oldest', 'middle', 'recent']);
  });

  it('遷移時刻が不明なタスクは、あなたの番グループの中で既知のものより後ろに送る', () => {
    const tasks = [
      { status: 'idle', sessionId: 'unknown-wait' },
      { status: 'idle', sessionId: 'known-wait', yourTurnSince: 100 },
    ];
    const groups = groupTasksForDisplay(tasks);
    expect(groups[0].tasks.map((t) => t.sessionId)).toEqual(['known-wait', 'unknown-wait']);
  });

  it('作業中・不明のグループは CLI が返した順のまま並べ替えない', () => {
    const tasks = [
      { status: 'busy', sessionId: 'w2' },
      { status: 'busy', sessionId: 'w1' },
    ];
    const groups = groupTasksForDisplay(tasks);
    expect(groups[0].tasks.map((t) => t.sessionId)).toEqual(['w2', 'w1']);
  });
});

describe('formatGroupHeading', () => {
  it('ラベルと件数を併記する', () => {
    expect(formatGroupHeading('your-turn', 2)).toBe('あなたの番 2件');
    expect(formatGroupHeading('working', 3)).toBe('作業中 3件');
    expect(formatGroupHeading('unknown', 1)).toBe('不明 1件');
  });
});

describe('waiting の翻訳（Issue #241 周2）', () => {
  it("status 'waiting' は「あなたの番」に翻訳される", () => {
    // claude 2.1.224 が返し始めた値。waitingFor に入りうるのは
    // permission prompt / input needed / dialog open の3つで、いずれも
    // 人間が操作するまで1歩も進まない（バイナリを読んで確定）。
    expect(toTaskState('waiting')).toBe('your-turn');
  });

  it('waiting は「あなたの番」の件数に数えられる（Dock バッジと同じ数）', () => {
    // ここが 1 のままだと、許可プロンプトで止まったセッションは
    // アプリを見ていない時間帯に検知手段がゼロになる。
    expect(countYourTurn([{ status: 'idle' }, { status: 'waiting' }, { status: 'busy' }])).toBe(2);
  });

  it('waiting は「不明」グループに落ちない', () => {
    const groups = groupTasksForDisplay([{ status: 'waiting' }, { status: 'busy' }]);
    expect(groups.map((g) => g.state)).toEqual(['your-turn', 'working']);
  });

  it('⛔ 確認していない値まで翻訳しない（waiting に似た語も unknown のまま）', () => {
    // 翻訳してよいのは値の集合を実測で確定できた語だけ、という規則を固定する。
    // ここが 'your-turn' になり始めたら、規則が破られている。
    for (const status of ['waiting_for_input', 'waiting-for-user', 'Waiting', 'blocked']) {
      expect(toTaskState(status)).toBe('unknown');
    }
  });

  it('busy -> waiting は「作業が終わった」として通知される（挙動は翻訳の前後で変わらない）', () => {
    expect(becameYourTurn('busy', 'waiting')).toBe(true);
  });

  it('waiting -> busy は通知しない（許可を押して作業に戻っただけ）', () => {
    expect(becameYourTurn('waiting', 'busy')).toBe(false);
  });

  it('idle -> waiting は通知しない（前回が working でない）', () => {
    // 通知が出ないので、この遷移は Dock バッジと一覧でしか気づけない。
    expect(becameYourTurn('idle', 'waiting')).toBe(false);
  });
});

describe('describeWaitingFor', () => {
  it('実測した3値を、4〜5文字に揃えた日本語にする', () => {
    expect(describeWaitingFor('permission prompt')).toBe('実行許可待ち');
    expect(describeWaitingFor('input needed')).toBe('入力待ち');
    expect(describeWaitingFor('dialog open')).toBe('ダイアログ待ち');
  });

  it('⛔ 「許可待ち」単独にしない（macOS の権限と誤読される）', () => {
    // このアプリは通知・アクセシビリティの許可を求める側でもあるので実際に紛らわしい。
    expect(describeWaitingFor('permission prompt')).not.toBe('許可待ち');
  });

  it('辞書に無い値は生のまま返す（鉄則5: CLI が言ったことを隠さない）', () => {
    // 実測した3値は 2.1.224 時点のもので CLI の約束ではない。4つ目が来たときに
    // 「不明」で塗り潰すと、CLI 側の変更に気づく手がかりが画面から消える。
    expect(describeWaitingFor('brand new reason')).toBe('brand new reason');
  });

  it('値が無ければ undefined（呼び出し側は何も出さない）', () => {
    expect(describeWaitingFor(undefined)).toBeUndefined();
    expect(describeWaitingFor('')).toBeUndefined();
  });
});
