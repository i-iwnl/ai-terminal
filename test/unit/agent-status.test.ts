// claude agents --json の status を、人間から見た意味へ翻訳する判定。
//
// 表示（TaskList）・通知（poller）・Dock バッジの3箇所がこの1つの実装を共有する。
// ここが壊れると「UI は不明と出すが通知は作業完了と言う」ような食い違いが生まれる。

import { describe, expect, it } from 'vitest';
import {
  toTaskState,
  countYourTurn,
  becameYourTurn,
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
