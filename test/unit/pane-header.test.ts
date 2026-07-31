// ペインヘッダの表示文字列（src/renderer/src/tabs/paneHeader.ts の paneHeaderLabel）。
//
// design-review.md 提案 G: 分割中のみ、各ペインの上に「zsh / claude /
// claude (再開)」+ cwd の basename を出す。tabTitle.ts の resolveAgentTabTitle
// （タブの見出し）とは目的が別（leaf.title は履歴の再開でユーザー由来の
// 表示名に化けうるため、そちらではなく ptyKind / isResume / cwd から独立に
// 組み立てる）。

import { describe, expect, it } from 'vitest';
import { paneHeaderLabel } from '../../src/renderer/src/tabs/paneHeader';
import type { PaneLeaf } from '../../src/renderer/src/tabs/paneTree';

function leaf(overrides: Partial<PaneLeaf>): PaneLeaf {
  return {
    kind: 'leaf',
    paneId: 'pane-1',
    ptyId: 'pty-1',
    ptyKind: 'shell',
    title: 'zsh',
    ...overrides,
  };
}

describe('paneHeaderLabel', () => {
  it('シェルペインは種別 zsh + cwd の basename', () => {
    expect(paneHeaderLabel(leaf({ ptyKind: 'shell', cwd: '/Users/foo/work/demo-project' }))).toBe(
      'zsh・demo-project',
    );
  });

  it('claude ペイン（非再開）は種別 claude + cwd の basename', () => {
    expect(
      paneHeaderLabel(leaf({ ptyKind: 'claude', cwd: '/Users/foo/work/repo-a', isResume: false })),
    ).toBe('claude・repo-a');
  });

  it('claude ペイン（再開）は "claude (再開)" になる', () => {
    expect(
      paneHeaderLabel(leaf({ ptyKind: 'claude', cwd: '/Users/foo/work/repo-a', isResume: true })),
    ).toBe('claude (再開)・repo-a');
  });

  it('gemini ペイン（再開）も同じ形式で "gemini (再開)" になる', () => {
    expect(
      paneHeaderLabel(leaf({ ptyKind: 'gemini', cwd: '/Users/foo/work/repo-b', isResume: true })),
    ).toBe('gemini (再開)・repo-b');
  });

  it('title に履歴由来のカスタム表示名が入っていても、種別の判定には使わない', () => {
    // resolveAgentTabTitle（tabTitle.ts）はタブの見出しを決める別の関数で、
    // 履歴からの再開では title が「過去のセッション」のような文字列に化ける。
    // paneHeaderLabel は title を一切参照しないので、その値に引きずられない。
    expect(
      paneHeaderLabel(
        leaf({ ptyKind: 'claude', title: '過去のセッション', cwd: '/Users/foo/work/repo-a', isResume: true }),
      ),
    ).toBe('claude (再開)・repo-a');
  });

  it('cwd が未解決（undefined）なら basename() の縮退表示 (不明) になる', () => {
    expect(paneHeaderLabel(leaf({ ptyKind: 'shell', cwd: undefined }))).toBe('zsh・(不明)');
  });

  it('isResume が未指定（分割で作った新しいシェル等）は非再開として扱う', () => {
    expect(paneHeaderLabel(leaf({ ptyKind: 'shell', cwd: '/repo', isResume: undefined }))).toBe(
      'zsh・repo',
    );
  });
});
