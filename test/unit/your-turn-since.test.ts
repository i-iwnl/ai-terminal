// poller.ts の「あなたの番になった時刻」記録更新（busy -> 非busy の遷移検知）を
// 切り出した純粋関数。「待たせている時間」（Issue #20 B / PR 8）の記録ロジックが
// 実際に動くことを固定する。固定 E2E フィクスチャは遷移を一度も起こさないため、
// このロジックはここでしか検証できない。

import { describe, expect, it } from 'vitest';
import { computeYourTurnSince } from '../../src/main/agents/yourTurnSince';

const NOW = Date.UTC(2026, 6, 30, 12, 0, 0);

describe('computeYourTurnSince', () => {
  it('busy -> 非busy の遷移で、その時刻を記録する', () => {
    const previous = [{ sessionId: 'a', status: 'busy' }];
    const current = [{ sessionId: 'a', status: 'idle' }];

    const result = computeYourTurnSince(new Map(), previous, current, NOW);

    expect(result.get('a')).toBe(NOW);
  });

  it('「あなたの番」のまま複数周期が経過しても、最初に記録した時刻が保たれる', () => {
    // ここが壊れると待ち時間が常に周期の間隔分（ほぼ0）に見え、機能が無意味になる。
    const firstTransition = computeYourTurnSince(
      new Map(),
      [{ sessionId: 'a', status: 'busy' }],
      [{ sessionId: 'a', status: 'idle' }],
      NOW,
    );
    expect(firstTransition.get('a')).toBe(NOW);

    // 次の周期: idle のまま（busy -> 非busy の遷移は起きていない）。
    const laterMs = NOW + 5 * 60_000;
    const secondCycle = computeYourTurnSince(
      firstTransition,
      [{ sessionId: 'a', status: 'idle' }],
      [{ sessionId: 'a', status: 'idle' }],
      laterMs,
    );

    // 上書きされて laterMs になっていないこと
    expect(secondCycle.get('a')).toBe(NOW);
  });

  it('非busy -> busy（作業中に戻る）で記録が消える', () => {
    const previousRecord = new Map([['a', NOW]]);

    const result = computeYourTurnSince(
      previousRecord,
      [{ sessionId: 'a', status: 'idle' }],
      [{ sessionId: 'a', status: 'busy' }],
      NOW + 60_000,
    );

    expect(result.has('a')).toBe(false);
  });

  it('未知の status を挟んだときは記録を消さない', () => {
    // 不明値を挟んだだけで、待たせ続けている可能性のほうが高いと判断する
    // （working への遷移だけを「記録を消す」条件にする、という意図的な設計判断）。
    const previousRecord = new Map([['a', NOW]]);

    const result = computeYourTurnSince(
      previousRecord,
      [{ sessionId: 'a', status: 'idle' }],
      [{ sessionId: 'a', status: 'waiting_for_input' }],
      NOW + 60_000,
    );

    expect(result.get('a')).toBe(NOW);
  });

  it('初回ポーリング（前回の一覧が無い）では何も記録しない', () => {
    // 起動時から既に「あなたの番」だったセッションは、比較対象が無いので
    // 遷移を検知できない。yourTurnSince は undefined のまま（縮退表示）。
    const result = computeYourTurnSince(
      new Map(),
      undefined,
      [{ sessionId: 'a', status: 'idle' }],
      NOW,
    );

    expect(result.has('a')).toBe(false);
  });

  it('一覧から消えたセッションの記録が掃除される', () => {
    // プロセスが終了して一覧から消えたセッションの記録を残し続けるとメモリリークになる。
    const previousRecord = new Map([
      ['a', NOW],
      ['gone', NOW - 1000],
    ]);

    const result = computeYourTurnSince(
      previousRecord,
      [
        { sessionId: 'a', status: 'idle' },
        { sessionId: 'gone', status: 'idle' },
      ],
      [{ sessionId: 'a', status: 'idle' }],
      NOW + 60_000,
    );

    expect(result.has('gone')).toBe(false);
    expect(result.get('a')).toBe(NOW);
  });

  it('入力の Map を書き換えない（呼び出し側の record を壊さない）', () => {
    const previousRecord = new Map([['a', NOW]]);

    computeYourTurnSince(
      previousRecord,
      [{ sessionId: 'a', status: 'idle' }],
      [{ sessionId: 'a', status: 'busy' }],
      NOW + 60_000,
    );

    // 呼び出し側に渡された Map 自体は変わっていない（新しい Map を返す設計）
    expect(previousRecord.get('a')).toBe(NOW);
  });
});
