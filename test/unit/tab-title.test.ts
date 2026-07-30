// タブタイトルの既定値の決定（src/renderer/src/tabs/tabTitle.ts の resolveAgentTabTitle）。
//
// Issue #20 C: 既定が `kind` 固定（`claude` / `gemini`）のままだと、3リポジトリで
// claude を起動しても `claude` `claude` `claude` としか並ばず区別できない
// （タブ幅は最大 180px あるのに情報量ゼロ）。cwd の basename に変えることで
// 見分けが付くようにする。

import { describe, expect, it } from 'vitest';
import { resolveAgentTabTitle } from '../../src/renderer/src/tabs/tabTitle';

describe('resolveAgentTabTitle', () => {
  it('明示的なタイトルが最優先される（履歴からの再開など）', () => {
    expect(resolveAgentTabTitle('claude', '/Users/foo/work/demo', false, 'セッション abcd1234')).toBe(
      'セッション abcd1234',
    );
  });

  it('明示的なタイトルが無く、既定（非再開）なら cwd の basename になる', () => {
    expect(resolveAgentTabTitle('claude', '/Users/foo/work/demo-project', false, undefined)).toBe(
      'demo-project',
    );
    expect(resolveAgentTabTitle('gemini', '/Users/foo/work/other-repo', false, undefined)).toBe(
      'other-repo',
    );
  });

  it('同じ kind でも cwd が違えば別のタイトルになる（3リポジトリで claude claude claude が並ぶ問題の再発防止）', () => {
    const a = resolveAgentTabTitle('claude', '/Users/foo/work/repo-a', false, undefined);
    const b = resolveAgentTabTitle('claude', '/Users/foo/work/repo-b', false, undefined);
    expect(a).not.toBe(b);
  });

  it('cwd が未解決（undefined）なら basename() の縮退表示 (不明) になる', () => {
    expect(resolveAgentTabTitle('claude', undefined, false, undefined)).toBe('(不明)');
  });

  it('明示的なタイトルが無く、再開の場合は "kind (再開)" のまま保つ', () => {
    expect(resolveAgentTabTitle('claude', '/Users/foo/work/demo-project', true, undefined)).toBe(
      'claude (再開)',
    );
    expect(resolveAgentTabTitle('gemini', '/Users/foo/work/demo-project', true, undefined)).toBe(
      'gemini (再開)',
    );
  });

  it('再開でも明示的なタイトルがあればそちらを使う', () => {
    expect(resolveAgentTabTitle('claude', '/Users/foo/work/demo-project', true, '過去のセッション')).toBe(
      '過去のセッション',
    );
  });
});
