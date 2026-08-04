// ペインヘッダの表示文字列（src/renderer/src/tabs/paneHeader.ts）。
//
// design-review.md 提案 G: 分割中のみ、各ペインの上に「zsh / claude /
// claude (再開)」+ cwd の basename を出す。tabTitle.ts の resolveAgentTabTitle
// （タブの見出し）とは目的が別（leaf.title は履歴の再開でユーザー由来の
// 表示名に化けうるため、そちらではなく ptyKind / isResume / cwd から独立に
// 組み立てる）。この性質は `paneKindLabel` がそのまま引き継いでいる。
//
// Issue #130: そのうえで**ヘッダに実際に描く文字列は分岐する**
// （`paneHeaderLabel`）。ユーザーが名前を付けたペインはその名前だけを出し、
// 見えなくなった側は `paneAccessibleLabel`（title 属性と aria-label の両方）へ回す。

import { describe, expect, it } from 'vitest';
import {
  SHELL_FALLBACK_LABEL,
  paneAccessibleLabel,
  paneHeaderLabel,
  paneKindLabel,
} from '../../src/renderer/src/tabs/paneHeader';
import type { PaneLeaf } from '../../src/renderer/src/tabs/paneTree';

function leaf(overrides: Partial<PaneLeaf>): PaneLeaf {
  return {
    kind: 'leaf',
    paneId: 'pane-1',
    ptyId: 'pty-1',
    ptyKind: 'shell',
    title: 'zsh',
    shellName: 'zsh',
    ...overrides,
  };
}

describe('paneHeaderLabel', () => {
  it('シェルペインは実際のシェル名 + cwd の basename', () => {
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

// --- Issue #130: 名前を付けたペイン -----------------------------------------

describe('paneHeaderLabel（名前を付けたペイン）', () => {
  it('renamed が立っていれば、その名前だけを出す', () => {
    expect(
      paneHeaderLabel(
        leaf({ ptyKind: 'claude', title: '認証まわりの調査', cwd: '/Users/foo/repo-a', renamed: true }),
      ),
    ).toBe('認証まわりの調査');
  });

  it('分割で作った2枚は、名前を付けるまで同じ文字列になる（この Issue が解く問題そのもの）', () => {
    // splitActivePane は必ず shell を spawn し、cwd を分割元から引き継ぐ。
    // したがって名前を付けるまで、2枚のヘッダは必ず衝突する。
    const left = leaf({ paneId: 'p1', ptyKind: 'shell', cwd: '/Users/foo/repo-a' });
    const right = leaf({ paneId: 'p2', ptyKind: 'shell', cwd: '/Users/foo/repo-a' });
    expect(paneHeaderLabel(left)).toBe(paneHeaderLabel(right));

    // 片方に名前を付けると分かれる。
    const named = { ...right, title: 'テスト実行', renamed: true };
    expect(paneHeaderLabel(left)).not.toBe(paneHeaderLabel(named));
    expect(paneHeaderLabel(named)).toBe('テスト実行');
  });

  it('**title が既定値のままでも renamed が無ければ種別・cwd を出す**（文字列比較で判定していない）', () => {
    // resolveAgentTabTitle の既定は basename(cwd) なので、title に
    // 'repo-a' が入っている状態が正常。これを「ユーザーが付けた名前」と
    // 誤認しないこと。
    expect(paneHeaderLabel(leaf({ ptyKind: 'claude', title: 'repo-a', cwd: '/Users/foo/repo-a' }))).toBe(
      'claude・repo-a',
    );
  });

  it('**ユーザーが既定値と同じ文字列を打った場合も、名前として扱う**（renamed が正）', () => {
    expect(
      paneHeaderLabel(
        leaf({ ptyKind: 'claude', title: 'repo-a', cwd: '/Users/foo/repo-a', renamed: true }),
      ),
    ).toBe('repo-a');
  });

  it('renamed が立っていても title が空白だけなら種別・cwd へ縮退する（鉄則5）', () => {
    expect(
      paneHeaderLabel(leaf({ ptyKind: 'shell', title: '   ', cwd: '/Users/foo/repo-a', renamed: true })),
    ).toBe('zsh・repo-a');
  });
});

describe('paneKindLabel', () => {
  it('renamed が立っていても、何が動いているかは title に影響されない', () => {
    expect(
      paneKindLabel(
        leaf({ ptyKind: 'claude', title: '認証まわりの調査', cwd: '/Users/foo/repo-a', isResume: true }),
      ),
    ).toBe('claude (再開)・repo-a');
  });
});

describe('paneAccessibleLabel', () => {
  it('名前を付けていなければ、種別・cwd を1回だけ出す（同じ文字列を2回並べない）', () => {
    expect(paneAccessibleLabel(leaf({ ptyKind: 'shell', cwd: '/Users/foo/repo-a' }))).toBe(
      'zsh・repo-a、シェル',
    );
  });

  it('名前を付けたら、可視テキストを先頭に置き、種別・cwd を後ろへ回す（WCAG 2.5.3）', () => {
    expect(
      paneAccessibleLabel(
        leaf({ ptyKind: 'claude', title: '認証まわりの調査', cwd: '/Users/foo/repo-a', renamed: true }),
      ),
    ).toBe('認証まわりの調査、claude・repo-a');
  });

  it('終了したペインは「終了」を末尾に足す（WebGL 描画のため読み上げに届く唯一の経路）', () => {
    expect(
      paneAccessibleLabel(
        leaf({
          ptyKind: 'claude',
          title: '認証まわりの調査',
          cwd: '/Users/foo/repo-a',
          renamed: true,
          exit: { exitCode: 1 },
        }),
      ),
    ).toBe('認証まわりの調査、claude・repo-a、終了');
  });

  it('名前が無く終了しているペインも、種別・cwd を2回並べない', () => {
    expect(
      paneAccessibleLabel(leaf({ ptyKind: 'shell', cwd: '/Users/foo/repo-a', exit: { exitCode: 0 } })),
    ).toBe('zsh・repo-a、シェル、終了');
  });

  it('exitCode 0（正常終了）でも「終了」を出す（exit の有無で判定していて、コードの値では判定していない）', () => {
    const label = paneAccessibleLabel(
      leaf({ ptyKind: 'shell', cwd: '/repo', exit: { exitCode: 0 } }),
    );
    expect(label.endsWith('、終了')).toBe(true);
  });
});

// Issue #137。ペインヘッダの種別ラベルは、実際に起動したシェルの実行ファイル名を出す。
//
// それまで `'zsh'` がハードコードされており、`$SHELL=/bin/fish` の人にも `zsh` と
// 表示していた。決定順の唯一の正は Main の `buildShellPlan()`
// （`config.shell -> $SHELL -> /bin/zsh`）で、Renderer は `AppConfig.shell` を
// 読んでも既定が undefined なので `$SHELL` を知りえない。そのため
// `SpawnPtyResult.shellName` -> `PaneLeaf.shellName` で値を運ぶ。
describe('paneKindLabel のシェル名（Issue #137）', () => {
  it('leaf.shellName をそのまま出す（zsh 決め打ちではない）', () => {
    expect(paneKindLabel(leaf({ ptyKind: 'shell', shellName: 'fish', cwd: '/Users/foo/repo' }))).toBe(
      'fish・repo',
    );
    expect(paneKindLabel(leaf({ ptyKind: 'shell', shellName: 'bash', cwd: '/Users/foo/repo' }))).toBe(
      'bash・repo',
    );
  });

  it('shellName が無ければ shell へ縮退する（**zsh へ戻さない**。鉄則5）', () => {
    expect(
      paneKindLabel(leaf({ ptyKind: 'shell', shellName: undefined, cwd: '/Users/foo/repo' })),
    ).toBe(`${SHELL_FALLBACK_LABEL}・repo`);
    // 空文字・空白だけも同じ扱い（外部から回り込む値を想定する）
    expect(paneKindLabel(leaf({ ptyKind: 'shell', shellName: '   ', cwd: '/Users/foo/repo' }))).toBe(
      `${SHELL_FALLBACK_LABEL}・repo`,
    );
  });

  it('claude / gemini は shellName を持っていても無視する', () => {
    // Main は kind !== 'shell' では shellName を埋めないが、万一入ってきても
    // claude のペインが `tmux` などと名乗らないことを型で固定する。
    expect(
      paneKindLabel(leaf({ ptyKind: 'claude', shellName: 'tmux', cwd: '/Users/foo/repo' })),
    ).toBe('claude・repo');
  });

  it('再開の表記はシェル名にも同じ形で乗る', () => {
    expect(
      paneKindLabel(leaf({ ptyKind: 'shell', shellName: 'fish', cwd: '/Users/foo/repo', isResume: true })),
    ).toBe('fish (再開)・repo');
  });
});

// Issue #137 の design-review（a11y）。分割中の非アクティブなペインは
// screenReaderMode が渡らず WebGL で描かれるため、支援技術から見て中身が空。
// そのペインについて届く情報は aria-label だけなので、**役割の語を必ず添える**。
describe('paneAccessibleLabel の役割語（Issue #137）', () => {
  it('シェルには「シェル」を添える（fish / nu が単独で読まれても、何かが分かる）', () => {
    expect(paneAccessibleLabel(leaf({ ptyKind: 'shell', shellName: 'fish', cwd: '/Users/foo/repo' }))).toBe(
      'fish・repo、シェル',
    );
  });

  it('claude / gemini には添えない（実行ファイル名と同じことを言っているため）', () => {
    expect(paneAccessibleLabel(leaf({ ptyKind: 'claude', cwd: '/Users/foo/repo' }))).toBe(
      'claude・repo',
    );
    expect(paneAccessibleLabel(leaf({ ptyKind: 'gemini', cwd: '/Users/foo/repo' }))).toBe(
      'gemini・repo',
    );
  });

  it('名前を付けたシェルペインでは、名前 -> 種別・cwd -> 役割語 の順になる（WCAG 2.5.3）', () => {
    expect(
      paneAccessibleLabel(
        leaf({
          ptyKind: 'shell',
          shellName: 'bash',
          title: 'ビルド用',
          cwd: '/Users/foo/repo',
          renamed: true,
        }),
      ),
    ).toBe('ビルド用、bash・repo、シェル');
  });
});
