// ターミナル内のリンクを開くクリックの判定（src/renderer/src/terminal/linkActivation.ts）。
//
// **なぜ純粋関数で固定するのか。** 開いた先は既定ブラウザなので Playwright から
// 観測できない。E2E（S93）が見られるのは「素のクリックで発火せず、Cmd+クリックで
// `shell.openExternal` が呼ばれる」という代表2ケースまでで、
// **修飾キーの組み合わせの網羅はここにしか書けない**。
//
// `@xterm/addon-web-links` は修飾キーを一切見ずにハンドラを呼ぶ
// （`ILinkProviderOptions` は hover / leave / urlRegex しか持たない）ので、
// 門はアプリ側で作るしかない。

import { describe, expect, it } from 'vitest';
import { shouldActivateLink } from '../../src/renderer/src/terminal/linkActivation';

/** MouseEvent の必要な部分だけを組み立てる（DOM を用意せずに判定を試す）。 */
function click(init: {
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  button?: number;
}): Parameters<typeof shouldActivateLink>[0] {
  return {
    metaKey: init.metaKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    altKey: init.altKey ?? false,
    button: init.button ?? 0,
  };
}

describe('shouldActivateLink', () => {
  it('Cmd+左クリックで開く（iTerm2 / Ghostty と同じ作法）', () => {
    expect(shouldActivateLink(click({ metaKey: true }))).toBe(true);
  });

  it('素の左クリックでは開かない（この Issue の本体）', () => {
    // カーソルを置くつもりのクリックでブラウザが前に出るのを止める。
    expect(shouldActivateLink(click({}))).toBe(false);
  });

  // **`Cmd+Shift+クリック` に相当するケースは書けない（書く必要が無い）。**
  // `LinkClick` は `shiftKey` を含まない = 関数から shift は見えないので、
  // 「Cmd が押されていれば shift の有無で結果が変わらない」ことは型が保証している。
  // ここに `shiftKey: true` を渡すテストを足しても、判定に使われていない値を
  // 渡すだけで何も検証しない（通ることの確認にしかならない）。

  it('Ctrl / Option が同時なら開かない（macOS では別の意味を持つ）', () => {
    // Ctrl+クリックは右クリック相当、Option+ドラッグは矩形選択。
    expect(shouldActivateLink(click({ metaKey: true, ctrlKey: true }))).toBe(false);
    expect(shouldActivateLink(click({ metaKey: true, altKey: true }))).toBe(false);
  });

  it('Cmd が無ければ、他の修飾キーが何であれ開かない', () => {
    expect(shouldActivateLink(click({ ctrlKey: true }))).toBe(false);
    expect(shouldActivateLink(click({ altKey: true }))).toBe(false);
    expect(shouldActivateLink(click({ ctrlKey: true, altKey: true }))).toBe(false);
  });

  it('主ボタン以外では開かない（右クリックはコンテキストメニューに割り当て済み）', () => {
    // Issue #135 でターミナル面の右クリックにメニューを載せてある。
    expect(shouldActivateLink(click({ metaKey: true, button: 1 }))).toBe(false);
    expect(shouldActivateLink(click({ metaKey: true, button: 2 }))).toBe(false);
  });
});
