// 完了通知（「Claude の作業が完了しました」）を出すタスクの選択。
//
// **この判定は poller.ts に埋め込まれていた間、単体テストも E2E も一度も実行していなかった。**
// 単体テストは Electron の app / Notification に依存する poller.ts を読めず、
// 固定 E2E フィクスチャは状態遷移を一度も起こさない。その結果、
// **一覧が1ミリも変わっていないのに毎ポーリング通知が出る**不具合（Issue #241）を素通しした。
//
// 先頭の describe が、その不具合そのものを固定する。

import { describe, expect, it } from 'vitest';

import { selectCompletedTasks } from '../../src/main/agents/completionNotice';

describe('selectCompletedTasks - 重複 sessionId（Issue #241）', () => {
  // 実機で観測した形（2026-08-07）。CLI 内の /resume で sessionId が乖離した結果、
  // **同じ sessionId を持つ別プロセスが2件**返ってきていた。
  const DUPLICATED = [
    { sessionId: '82dae66a', pid: 47307, status: 'waiting' },
    { sessionId: '82dae66a', pid: 80821, status: 'busy' },
  ];
  // `waiting` が 'unknown' でも 'your-turn' でも、`becameYourTurn` から見れば
  // どちらも「working ではない」なので、この判定は #241 周2 の翻訳に影響されない。

  it('一覧が前回とまったく同じなら、何も通知しない', () => {
    // ⭐ ここが Issue #241 の本体。sessionId で畳むと Map が後勝ちで busy の行に潰れ、
    // waiting の行が「busy から遷移した」と誤検知され、**毎ポーリング通知が出続ける**。
    const completed = selectCompletedTasks(DUPLICATED, DUPLICATED);

    expect(completed).toEqual([]);
  });

  it('何周回しても通知は出ない（無限ループにならない）', () => {
    // 実機では pollIntervalMs = 3000 なので、1周あたり1件でも鳴り続ける。
    let previous = DUPLICATED;
    for (let cycle = 0; cycle < 5; cycle++) {
      expect(selectCompletedTasks(previous, DUPLICATED)).toEqual([]);
      previous = DUPLICATED;
    }
  });

  it('重複していても、実際に遷移した pid のぶんだけ通知する', () => {
    const current = [
      { sessionId: '82dae66a', pid: 47307, status: 'waiting' },
      { sessionId: '82dae66a', pid: 80821, status: 'idle' }, // busy -> idle で本当に終わった
    ];

    const completed = selectCompletedTasks(DUPLICATED, current);

    expect(completed).toHaveLength(1);
    expect(completed[0].pid).toBe(80821);
  });

  it('pid が取れていない重複では、遷移を検知せず黙る', () => {
    // pid が無いと同一性を決められない。**曖昧なまま片方と比べるより、
    // 通知を1回落とすほうが安全**（何も起きていないのに鳴り続けるのが最悪）。
    const previous = [
      { sessionId: 'dup', status: 'busy' },
      { sessionId: 'dup', status: 'busy' },
    ];
    const current = [
      { sessionId: 'dup', status: 'busy' },
      { sessionId: 'dup', status: 'idle' },
    ];

    expect(selectCompletedTasks(previous, current)).toEqual([]);
  });
});

describe('selectCompletedTasks - 基本の遷移', () => {
  it('busy -> idle で通知する', () => {
    const completed = selectCompletedTasks(
      [{ sessionId: 'a', pid: 1, status: 'busy' }],
      [{ sessionId: 'a', pid: 1, status: 'idle' }],
    );

    expect(completed).toHaveLength(1);
    expect(completed[0].sessionId).toBe('a');
  });

  it('busy -> 未知の status でも通知する', () => {
    // 「通知が来ないことには気づけない」ので、CLI が新しい語を返し始めても止めない
    // （src/shared/agent-status.ts の becameYourTurn の設計判断）。
    // ⛔ ここに `waiting` を使わないこと。**`waiting` は既知の値になった**ので
    // （#241 周2 で `toTaskState` が翻訳する）、未知の代表としては嘘になる。
    const completed = selectCompletedTasks(
      [{ sessionId: 'a', pid: 1, status: 'busy' }],
      [{ sessionId: 'a', pid: 1, status: 'waiting_for_input' }],
    );

    expect(completed).toHaveLength(1);
  });

  it('busy のままでは通知しない', () => {
    expect(
      selectCompletedTasks(
        [{ sessionId: 'a', pid: 1, status: 'busy' }],
        [{ sessionId: 'a', pid: 1, status: 'busy' }],
      ),
    ).toEqual([]);
  });

  it('idle のまま何周しても通知しない（1回の完了につき通知は1回）', () => {
    expect(
      selectCompletedTasks(
        [{ sessionId: 'a', pid: 1, status: 'idle' }],
        [{ sessionId: 'a', pid: 1, status: 'idle' }],
      ),
    ).toEqual([]);
  });

  it('初回ポーリング（前回の一覧が無い）では何も通知しない', () => {
    // ⚠ これは characterization であって関門ではない。`undefined` は空配列と同じ扱いなので、
    // **この振る舞いだけを壊す方法が無い**（早期 return を置いて外しても緑のままであることを
    // 実測した）。実質の担保は下の「新しく現れたセッションは通知しない」が持つ。
    expect(selectCompletedTasks(undefined, [{ sessionId: 'a', pid: 1, status: 'idle' }])).toEqual([]);
  });

  it('新しく現れたセッションは通知しない（前回が無い）', () => {
    expect(
      selectCompletedTasks([], [{ sessionId: 'new', pid: 2, status: 'idle' }]),
    ).toEqual([]);
  });
});

describe('selectCompletedTasks - 一覧から消えたセッション', () => {
  it('busy のまま消えた（プロセス終了）ものは通知する', () => {
    const completed = selectCompletedTasks([{ sessionId: 'a', pid: 1, status: 'busy' }], []);

    expect(completed).toHaveLength(1);
    expect(completed[0].sessionId).toBe('a');
  });

  it('idle で消えたものは通知しない（busy -> idle の時点で通知済み）', () => {
    expect(selectCompletedTasks([{ sessionId: 'a', pid: 1, status: 'idle' }], [])).toEqual([]);
  });

  it('sessionId が /resume で変わっても、pid が同じなら消えたとは見なさない', () => {
    // ⭐ CLI 内の /resume は sessionId を切り替える（sessionMatch.ts）。sessionId で
    // 突き合わせると「busy のまま消えた」と誤検知し、**まだ動いているのに完了通知が出る**。
    const completed = selectCompletedTasks(
      [{ sessionId: 'before', pid: 42, status: 'busy' }],
      [{ sessionId: 'after', pid: 42, status: 'busy' }],
    );

    expect(completed).toEqual([]);
  });
});
