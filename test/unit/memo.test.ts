// メモ（~/.ai-terminal/memos.json）の更新と一覧の組み立て。
//
// 保存キーの形（`global` / `session:<provider>:<stableId>`）はこのファイルの
// テストが唯一の外部仕様。キーの形を変えると保存済みのメモが読めなくなるので、
// ここで固定しておく。

import { describe, expect, it } from 'vitest';
import { applyMemoUpdate, buildListResult } from '../../src/main/memo/store';

const NOW = Date.UTC(2026, 6, 28, 12, 0, 0);

describe('applyMemoUpdate', () => {
  it('全体メモを global キーに保存する', () => {
    const next = applyMemoUpdate({}, { scope: 'global', body: 'あとで直す' }, NOW);
    expect(next).toEqual({ global: { body: 'あとで直す', updatedAt: NOW, title: undefined } });
  });

  it('セッションメモを provider と stableId でキー付けする', () => {
    const next = applyMemoUpdate(
      {},
      { scope: 'session', provider: 'claude', stableId: 'abc-123', body: '調査中', title: 'タブの不具合' },
      NOW,
    );
    expect(next['session:claude:abc-123']).toEqual({
      body: '調査中',
      updatedAt: NOW,
      title: 'タブの不具合',
    });
  });

  it('本文を空にすると、そのメモを削除する', () => {
    const before = { global: { body: '書いた', updatedAt: 1 } };
    expect(applyMemoUpdate(before, { scope: 'global', body: '' }, NOW)).toEqual({});
    // 空白だけの入力も「消したい」とみなす
    expect(applyMemoUpdate(before, { scope: 'global', body: '   \n  ' }, NOW)).toEqual({});
  });

  it('本文の前後の空白や改行は保存時に削らない', () => {
    // 「空かどうか」の判定にだけ trim を使い、書いた通りの本文を残す
    const next = applyMemoUpdate({}, { scope: 'global', body: '  段付き\n\n' }, NOW);
    expect(next.global.body).toBe('  段付き\n\n');
  });

  it('title を省略した更新では、保存済みの表示名を維持する', () => {
    const before = {
      'session:claude:abc': { body: '前', updatedAt: 1, title: '元のタイトル' },
    };
    const next = applyMemoUpdate(
      before,
      { scope: 'session', provider: 'claude', stableId: 'abc', body: '後' },
      NOW,
    );
    expect(next['session:claude:abc'].title).toBe('元のタイトル');
  });

  it('元のマップを書き換えない', () => {
    const before = { global: { body: '元', updatedAt: 1 } };
    applyMemoUpdate(before, { scope: 'global', body: '新' }, NOW);
    expect(before.global.body).toBe('元');
  });

  it('provider / stableId が欠けたセッションメモは何も変えない', () => {
    // IPC 越しに不正な形が来ても、既存のメモを壊さない
    const before = { global: { body: '元', updatedAt: 1 } };
    expect(applyMemoUpdate(before, { scope: 'session', body: '本文' }, NOW)).toBe(before);
  });
});

describe('buildListResult', () => {
  it('全体メモが無くても空のエントリを返す', () => {
    // 呼び出し側で「メモが無い場合」を分岐させないための約束
    const result = buildListResult({});
    expect(result.global).toEqual({ scope: 'global', body: '', updatedAt: 0 });
    expect(result.sessions).toEqual([]);
  });

  it('セッションメモを updatedAt の降順に並べる', () => {
    const result = buildListResult({
      'session:claude:old': { body: '古い', updatedAt: 100 },
      'session:claude:new': { body: '新しい', updatedAt: 300 },
      'session:gemini:mid': { body: '中間', updatedAt: 200 },
    });
    expect(result.sessions.map((m) => m.stableId)).toEqual(['new', 'mid', 'old']);
  });

  it('保存キーから provider と stableId を復元する', () => {
    const result = buildListResult({ 'session:gemini:uuid-1': { body: 'x', updatedAt: 1 } });
    expect(result.sessions[0]).toMatchObject({
      scope: 'session',
      provider: 'gemini',
      stableId: 'uuid-1',
    });
  });

  it('stableId にコロンが含まれていても分割位置を間違えない', () => {
    const result = buildListResult({ 'session:claude:a:b:c': { body: 'x', updatedAt: 1 } });
    expect(result.sessions[0].stableId).toBe('a:b:c');
  });

  it('未知の provider や壊れたキーは読み捨てる', () => {
    // 手で書き足された行や、将来の provider が混ざっていても落ちない
    const result = buildListResult({
      'session:unknown:x': { body: 'x', updatedAt: 1 },
      'session:claude:': { body: 'x', updatedAt: 1 },
      'session:claude': { body: 'x', updatedAt: 1 },
      なにこれ: { body: 'x', updatedAt: 1 },
      'session:claude:ok': { body: 'x', updatedAt: 1 },
    });
    expect(result.sessions.map((m) => m.stableId)).toEqual(['ok']);
  });
});
