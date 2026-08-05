// `Cmd+F` が xterm の選択範囲を検索欄へ引き継ぐかの判定（Issue #175）。
//
// **引き継がない = 検索欄を触らない**（空にするのではない）。ここを取り違えると、
// 行末の余白を撫でただけで前回の検索語が消える。

import { describe, expect, it } from 'vitest';
import { searchSeedFromSelection } from '../../src/renderer/src/terminal/searchSeed';

describe('searchSeedFromSelection', () => {
  it('選択が無ければ引き継がない', () => {
    expect(searchSeedFromSelection('')).toBeNull();
    expect(searchSeedFromSelection(undefined)).toBeNull();
    expect(searchSeedFromSelection(null)).toBeNull();
  });

  it('普通の語はそのまま引き継ぐ', () => {
    expect(searchSeedFromSelection('ERROR')).toBe('ERROR');
  });

  it('前後の空白は落とす（行の右端まで撫でたときの余白を検索語に含めない）', () => {
    expect(searchSeedFromSelection('  ERROR   ')).toBe('ERROR');
  });

  it('語句の中の空白は残す（git status のような語をそのまま探せる）', () => {
    expect(searchSeedFromSelection('git status')).toBe('git status');
  });

  it('空白だけの選択は引き継がない（前回の語を空白で上書きしない）', () => {
    expect(searchSeedFromSelection('    ')).toBeNull();
    expect(searchSeedFromSelection('\t')).toBeNull();
  });

  it('複数行の選択は引き継がない（検索アドオンが行をまたげない）', () => {
    expect(searchSeedFromSelection('foo\nbar')).toBeNull();
    expect(searchSeedFromSelection('foo\r\nbar')).toBeNull();
    // 末尾の改行1つでも引き継がない（行まるごとの選択がこの形になる）。
    expect(searchSeedFromSelection('foo\n')).toBeNull();
  });

  it('日本語・記号・パスも引き継ぐ（端末に出るものを狭めない）', () => {
    expect(searchSeedFromSelection('エラー')).toBe('エラー');
    expect(searchSeedFromSelection('/Users/me/work/a.ts:42')).toBe('/Users/me/work/a.ts:42');
    expect(searchSeedFromSelection('--session-id')).toBe('--session-id');
  });
});
