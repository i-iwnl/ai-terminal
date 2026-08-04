// tabs/tabExitCopy.ts（Issue #166 / #179 周3）の単体テスト。
//
// **語の関門はここに置く。** 直す前は「終了」という語が5箇所（タブのバッジ・
// タブの aria-label・ペインの aria-label・…）に散っていて、**どれも文字列
// リテラルだった**。E2E 側は `[aria-label*="終了"]` で見ていたが、これは
// `終了済み` にも `異常終了` にも `強制終了` にも部分一致するので、
// **語を細分化しても壊れずに恒真化する**（design-review で3人が指摘）。
// 語そのものの正はこのファイルが持ち、E2E は「その語が画面に出ているか」を見る。

import { describe, expect, it } from 'vitest';
import type { PaneLeaf, PaneNode, PaneSplit } from '../../src/renderer/src/tabs/paneTree';
import { exitDetail, exitWord, tabExitCopy } from '../../src/renderer/src/tabs/tabExitCopy';

function leaf(overrides: Partial<PaneLeaf> = {}): PaneLeaf {
  return {
    kind: 'leaf',
    paneId: 'pane-1',
    ptyId: 'pty-1',
    ptyKind: 'shell',
    title: 'zsh',
    ...overrides,
  };
}

function splitRow(children: [PaneNode, PaneNode]): PaneSplit {
  return { kind: 'split', dir: 'row', children, ratio: 0.5 };
}

describe('exitWord（可視の語）', () => {
  it('正常終了は 終了済み', () => {
    expect(exitWord({ exitCode: 0 })).toBe('終了済み');
    expect(exitWord({ exitCode: 0, signal: 0 })).toBe('終了済み');
  });

  it('異常終了は 異常終了', () => {
    expect(exitWord({ exitCode: 1 })).toBe('異常終了');
    expect(exitWord({ exitCode: 0, signal: 9 })).toBe('異常終了');
  });

  // **可視の語は4文字で固定する。** 可変長にするとタブが max-width まで膨らみ、
  // 右隣以降のタブが横滑りしてタイトルが省略記号だけになる（design-review の実測）。
  // ここが崩れると、その被害が全部タイトルの取り分に回る。
  it('可視の語は必ず4文字（タブ幅が状態で動かない）', () => {
    for (const exit of [{ exitCode: 0 }, { exitCode: 1 }, { exitCode: 130 }, { exitCode: 0, signal: 9 }]) {
      expect(exitWord(exit), JSON.stringify(exit)).toHaveLength(4);
    }
  });

  // ⛔ `強制終了` は macOS の Apple メニューの実コマンド名（Force Quit）。
  // `終了` を捨てた理由（押せる要素の中で動詞に読める）がそのまま当てはまる。
  it('「強制終了」も裸の「終了」も使わない', () => {
    const words = [{ exitCode: 0 }, { exitCode: 1 }, { exitCode: 0, signal: 9 }].map(exitWord);
    expect(words).not.toContain('強制終了');
    expect(words).not.toContain('終了');
  });
});

describe('exitDetail（生値つきの語）', () => {
  it('正常終了は可視の語と同じ（生値を足さない）', () => {
    expect(exitDetail({ exitCode: 0 })).toBe('終了済み');
  });

  it('0 以外のコードはコードを添える', () => {
    expect(exitDetail({ exitCode: 1 })).toBe('異常終了（コード 1）');
    expect(exitDetail({ exitCode: 130 })).toBe('異常終了（コード 130）');
  });

  it('シグナルはシグナル番号を添える（コードではなく）', () => {
    // exitCode 0 + signal 9 で「コード 0」と言うと、
    // 「エラーと言いながらコード 0」という食い違いになる。
    expect(exitDetail({ exitCode: 0, signal: 9 })).toBe('異常終了（シグナル 9）');
  });

  it('signal: 0 は「シグナル無し」なので正常終了のまま', () => {
    expect(exitDetail({ exitCode: 0, signal: 0 })).toBe('終了済み');
  });

  // WCAG 2.5.3 Label in Name: 可視テキストがアクセシブルネームに含まれないと、
  // 音声操作で「異常終了」と言っても押せなくなる。
  it('必ず可視の語を先頭に含む（Label in Name）', () => {
    for (const exit of [{ exitCode: 0 }, { exitCode: 7 }, { exitCode: 0, signal: 15 }]) {
      expect(exitDetail(exit).startsWith(exitWord(exit)), JSON.stringify(exit)).toBe(true);
    }
  });
});

describe('tabExitCopy（タブ単位）', () => {
  it('生きているペインがあれば undefined', () => {
    expect(tabExitCopy(leaf())).toBeUndefined();
    expect(
      tabExitCopy(splitRow([leaf({ paneId: 'a', exit: { exitCode: 1 } }), leaf({ paneId: 'b' })])),
    ).toBeUndefined();
  });

  it('全部が正常終了なら 終了済み', () => {
    expect(tabExitCopy(leaf({ exit: { exitCode: 0 } }))).toEqual({
      badge: '終了済み',
      detail: '終了済み',
    });
  });

  // **語も `some` で畳む。** 色（tabExitState）と代表の選び方が違うと、
  // 「タブは赤いのに読み上げは終了済みと言う」という食い違いが出る。
  it('片方が異常なら、異常のほうを代表にする（色の集約と揃える）', () => {
    const layout = splitRow([
      leaf({ paneId: 'a', exit: { exitCode: 0 } }),
      leaf({ paneId: 'b', exit: { exitCode: 7 } }),
    ]);
    expect(tabExitCopy(layout)).toEqual({ badge: '異常終了', detail: '異常終了（コード 7）' });
  });

  it('並び順によらず異常を拾う', () => {
    const layout = splitRow([
      leaf({ paneId: 'a', exit: { exitCode: 0, signal: 15 } }),
      leaf({ paneId: 'b', exit: { exitCode: 0 } }),
    ]);
    expect(tabExitCopy(layout)?.detail).toBe('異常終了（シグナル 15）');
  });
});
