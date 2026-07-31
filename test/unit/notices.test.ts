// 通知バナーの配列管理（Issue #20 PR 11）を切り出した純粋関数のテスト。
// 単一文字列だった通知を配列 + severity にした際の中核ロジックなので、
// このファイル単体で「追加」「削除」「上限を超えたときの扱い」「severity の判定」を固定する。

import { describe, expect, it } from 'vitest';
import {
  MAX_NOTICES,
  dismissNotice,
  pushNotice,
  severityForExit,
  type Notice,
} from '../../src/renderer/src/lib/notices';

describe('severityForExit', () => {
  it('exitCode 0 かつ signal 無しは info（正常終了）', () => {
    expect(severityForExit({ exitCode: 0 })).toBe('info');
  });

  it('exitCode が 0 以外なら error', () => {
    expect(severityForExit({ exitCode: 1 })).toBe('error');
    expect(severityForExit({ exitCode: 137 })).toBe('error');
  });

  it('exitCode が 0 でも signal が立っていれば error', () => {
    expect(severityForExit({ exitCode: 0, signal: 9 })).toBe('error');
  });

  it('signal が 0（= シグナル無し）なら exitCode 0 と合わせて info のまま', () => {
    expect(severityForExit({ exitCode: 0, signal: 0 })).toBe('info');
  });
});

describe('pushNotice', () => {
  const notice = (id: string): Notice => ({ id, message: `msg-${id}`, severity: 'info' });

  it('空の配列に1件追加できる', () => {
    expect(pushNotice([], notice('1'))).toEqual([notice('1')]);
  });

  it('既存の通知を消さずに末尾へ追加する（配列化のいちばんの目的）', () => {
    const prev = [notice('1')];
    expect(pushNotice(prev, notice('2'))).toEqual([notice('1'), notice('2')]);
  });

  it('上限を超えたら古いものから捨てる（既定 MAX_NOTICES 件）', () => {
    const prev = Array.from({ length: MAX_NOTICES }, (_, i) => notice(String(i)));
    const result = pushNotice(prev, notice('new'));
    expect(result).toHaveLength(MAX_NOTICES);
    // 一番古い '0' が落ち、末尾に 'new' が付く
    expect(result[0].id).toBe('1');
    expect(result[result.length - 1].id).toBe('new');
  });

  it('上限を明示的に指定できる（呼び出し側の既定値差し替え用）', () => {
    const prev = [notice('1'), notice('2')];
    const result = pushNotice(prev, notice('3'), 2);
    expect(result).toEqual([notice('2'), notice('3')]);
  });

  it('呼び出し元の配列を変更しない（不変性）', () => {
    const prev = [notice('1')];
    const prevCopy = [...prev];
    pushNotice(prev, notice('2'));
    expect(prev).toEqual(prevCopy);
  });
});

describe('dismissNotice', () => {
  const notice = (id: string): Notice => ({ id, message: `msg-${id}`, severity: 'error' });

  it('id が一致する1件だけを取り除く', () => {
    const prev = [notice('1'), notice('2'), notice('3')];
    expect(dismissNotice(prev, '2')).toEqual([notice('1'), notice('3')]);
  });

  it('他の通知を独立して閉じられる（配列化前は1件しか持てず、この区別自体が無かった）', () => {
    const prev = [notice('1'), notice('2')];
    const afterClosingFirst = dismissNotice(prev, '1');
    expect(afterClosingFirst).toEqual([notice('2')]);
  });

  it('該当 id が無ければ変化しない', () => {
    const prev = [notice('1')];
    expect(dismissNotice(prev, 'no-such-id')).toEqual(prev);
  });
});
