// Renderer 側の純粋関数（表示整形とショートカット判定）。
//
// ショートカットは「ターミナル本来のキー入力と絶対に衝突しない」ことが要件で、
// 画面を見ても衝突に気づけない（Ctrl+C が奪われて初めて分かる）ため、
// 判定の境界をここで固定する。

import { describe, expect, it } from 'vitest';
import { formatRelativeTime, sessionDisplayTitle, basename } from '../../src/renderer/src/lib/format';
import { matchShortcut } from '../../src/renderer/src/lib/shortcuts';

/** KeyboardEvent の必要な部分だけを組み立てる（DOM を用意せずに判定を試す）。 */
function keyEvent(init: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}): KeyboardEvent {
  return {
    key: init.key,
    metaKey: init.metaKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    altKey: init.altKey ?? false,
    shiftKey: init.shiftKey ?? false,
  } as KeyboardEvent;
}

describe('matchShortcut', () => {
  it('Cmd 無しのキーはすべて素通しする', () => {
    // ターミナルへの入力を奪わないための最重要の性質
    expect(matchShortcut(keyEvent({ key: 't' }))).toBeNull();
    expect(matchShortcut(keyEvent({ key: 'c', ctrlKey: true }))).toBeNull();
    expect(matchShortcut(keyEvent({ key: '1' }))).toBeNull();
  });

  it('Cmd と Ctrl / Alt の同時押しは対象外にする', () => {
    expect(matchShortcut(keyEvent({ key: 't', metaKey: true, ctrlKey: true }))).toBeNull();
    expect(matchShortcut(keyEvent({ key: 't', metaKey: true, altKey: true }))).toBeNull();
  });

  it('タブ操作を判定する', () => {
    expect(matchShortcut(keyEvent({ key: 't', metaKey: true }))).toEqual({ type: 'new-shell-tab' });
    expect(matchShortcut(keyEvent({ key: 'w', metaKey: true }))).toEqual({ type: 'close-tab' });
    expect(matchShortcut(keyEvent({ key: '3', metaKey: true }))).toEqual({
      type: 'switch-tab',
      index: 2,
    });
  });

  // Cmd+K は iTerm2 / Terminal.app / Ghostty のいずれでも「画面を消去」。
  // ここを AI CLI の起動に使うと、クリアのつもりで押した人が claude を1本余計に起動する。
  it('Cmd+K は画面の消去に割り当てる（AI CLI の起動ではない）', () => {
    expect(matchShortcut(keyEvent({ key: 'k', metaKey: true }))).toEqual({
      type: 'clear-terminal',
    });
  });

  it('AI CLI の起動は Cmd+Shift 系に置く', () => {
    expect(matchShortcut(keyEvent({ key: 'c', metaKey: true, shiftKey: true }))).toEqual({
      type: 'new-claude-tab',
    });
    // gemini は Cmd+Shift+E（g-E-mini の E）。Cmd+Shift+G は「前を検索」に明け渡した
    // （下の再発防止テスト参照）。
    expect(matchShortcut(keyEvent({ key: 'e', metaKey: true, shiftKey: true }))).toEqual({
      type: 'new-gemini-tab',
    });
  });

  // Issue #62: Cmd+Shift+G は Safari / Xcode / TextEdit など macOS 全域で「前を検索」の
  // 標準キー。ここを以前は gemini の起動に割り当てており、検索中に反射で押すと
  // 本物の gemini が1本余計に起動する事故があった（Cmd+K を画面消去に残した経緯と
  // 同じ型の事故）。二度と gemini の起動に割り当てないことをここで固定する。
  it('Cmd+Shift+G は前を検索に割り当てる（gemini の起動ではない）', () => {
    expect(matchShortcut(keyEvent({ key: 'g', metaKey: true, shiftKey: true }))).toEqual({
      type: 'find-previous',
    });
  });

  it('Cmd+G は次を検索に割り当てる', () => {
    expect(matchShortcut(keyEvent({ key: 'g', metaKey: true }))).toEqual({
      type: 'find-next',
    });
  });

  it('Cmd+Shift 系に割り当てていないキーは対象外にする', () => {
    expect(matchShortcut(keyEvent({ key: 't', metaKey: true, shiftKey: true }))).toBeNull();
    expect(matchShortcut(keyEvent({ key: 'k', metaKey: true, shiftKey: true }))).toBeNull();
  });

  it('Cmd+, で設定を開く', () => {
    expect(matchShortcut(keyEvent({ key: ',', metaKey: true }))).toEqual({
      type: 'toggle-settings',
    });
  });

  it('Cmd+0 はタブ切り替えに割り当てない', () => {
    // 添字が -1 になるため 1〜9 のみを受け付ける
    expect(matchShortcut(keyEvent({ key: '0', metaKey: true }))).toBeNull();
  });
});

describe('formatRelativeTime', () => {
  const NOW = Date.UTC(2026, 6, 28, 12, 0, 0);

  it('10秒未満は「たった今」', () => {
    expect(formatRelativeTime(NOW - 3000, NOW)).toBe('たった今');
  });

  it('分・時間・日で単位を切り替える', () => {
    expect(formatRelativeTime(NOW - 30_000, NOW)).toBe('30秒前');
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toBe('5分前');
    expect(formatRelativeTime(NOW - 3 * 3_600_000, NOW)).toBe('3時間前');
    expect(formatRelativeTime(NOW - 2 * 86_400_000, NOW)).toBe('2日前');
  });

  it('未来の時刻でも負の値を表示しない', () => {
    // ファイルの mtime が未来になっている環境がありうる
    expect(formatRelativeTime(NOW + 100_000, NOW)).toBe('たった今');
  });
});

describe('sessionDisplayTitle', () => {
  const base = { provider: 'claude' as const, sessionId: 'abcdefgh-1234', updatedAt: 0 };

  it('title を最優先で使う', () => {
    expect(sessionDisplayTitle({ ...base, title: '上書き', firstPrompt: '最初の発話' })).toBe(
      '上書き',
    );
  });

  it('title が無ければ firstPrompt を使う', () => {
    expect(sessionDisplayTitle({ ...base, firstPrompt: '最初の発話' })).toBe('最初の発話');
  });

  it('どちらも無ければセッション ID の先頭8文字で縮退する', () => {
    expect(sessionDisplayTitle(base)).toBe('セッション abcdefgh');
  });

  it('パースに失敗した履歴では firstPrompt を使わない', () => {
    // 壊れた JSONL から拾った本文は信用しない（title の上書きだけは尊重する）
    expect(sessionDisplayTitle({ ...base, parseError: '壊れています', firstPrompt: 'ゴミ' })).toBe(
      'セッション abcdefgh',
    );
    expect(
      sessionDisplayTitle({ ...base, parseError: '壊れています', title: '手で付けた名前' }),
    ).toBe('手で付けた名前');
  });
});

describe('basename', () => {
  it('末尾のディレクトリ名を取り出す', () => {
    expect(basename('/Users/me/work/demo-project')).toBe('demo-project');
  });

  it('末尾のスラッシュを無視する', () => {
    expect(basename('/Users/me/work/demo-project/')).toBe('demo-project');
  });

  it('undefined は「(不明)」にする', () => {
    expect(basename(undefined)).toBe('(不明)');
  });
});
