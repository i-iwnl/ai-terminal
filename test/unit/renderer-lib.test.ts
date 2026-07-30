// Renderer 側の純粋関数（表示整形とショートカット判定）。
//
// ショートカットは「ターミナル本来のキー入力と絶対に衝突しない」ことが要件で、
// 画面を見ても衝突に気づけない（Ctrl+C が奪われて初めて分かる）ため、
// 判定の境界をここで固定する。

import { describe, expect, it } from 'vitest';
import {
  formatRelativeTime,
  formatWaitingSince,
  sessionDisplayTitle,
  basename,
} from '../../src/renderer/src/lib/format';
import { isEditableTarget, matchShortcut } from '../../src/renderer/src/lib/shortcuts';

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

/**
 * isEditableTarget が見る最小限のプロパティだけを持つ、素の DOM 要素を模したオブジェクト。
 * unit テストは environment: 'node' で動く（jsdom を使わない）ため、実 DOM 要素は
 * 作れない。isEditableTarget 自体が duck typing で実装されているので、
 * ここでも実要素を作らず、同じ形のプロパティを持つだけのオブジェクトで検証する。
 */
function fakeElement(init: {
  tagName?: string;
  classNames?: string[];
  isContentEditable?: boolean;
  /** この要素（または祖先）が一致するとみなすセレクタの集合。closest() のスタブ用。 */
  closestMatches?: string[];
}): EventTarget {
  const classNames = init.classNames ?? [];
  const closestMatches = init.closestMatches ?? [];
  return {
    tagName: init.tagName,
    isContentEditable: init.isContentEditable ?? false,
    classList: {
      contains: (name: string) => classNames.includes(name),
    },
    closest: (selector: string) => (closestMatches.includes(selector) ? ({} as Element) : null),
  } as unknown as EventTarget;
}

describe('isEditableTarget', () => {
  it('通常の input / textarea は編集中と判定する', () => {
    expect(isEditableTarget(fakeElement({ tagName: 'INPUT' }))).toBe(true);
    expect(isEditableTarget(fakeElement({ tagName: 'TEXTAREA' }))).toBe(true);
  });

  it('contenteditable な要素は編集中と判定する', () => {
    expect(isEditableTarget(fakeElement({ tagName: 'DIV', isContentEditable: true }))).toBe(true);
  });

  // xterm.js はターミナルへのキー入力を受けるために画面外の <textarea> を常時
  // フォーカスさせている。ここが「編集中」と誤判定されると、ターミナル操作中は
  // 常にアプリのショートカットが死ぬ（全ショートカットが機能しなくなる）ため、
  // 他とは独立したケースとして固定する。
  it('xterm-helper-textarea は編集中と判定しない（誤ると全ショートカットが死ぬ）', () => {
    expect(
      isEditableTarget(fakeElement({ tagName: 'TEXTAREA', classNames: ['xterm-helper-textarea'] })),
    ).toBe(false);
  });

  // 検索入力欄は Cmd+F / Cmd+G がフォーカスの有無に関わらず効く設計を維持するため、
  // あえて編集中の対象外にしている（shortcuts.ts のコメント参照）。
  it('検索入力欄（.terminal-search 配下）は編集中と判定しない', () => {
    expect(
      isEditableTarget(fakeElement({ tagName: 'INPUT', closestMatches: ['.terminal-search'] })),
    ).toBe(false);
  });

  it('div や button など通常の要素は編集中と判定しない', () => {
    expect(isEditableTarget(fakeElement({ tagName: 'DIV' }))).toBe(false);
    expect(isEditableTarget(fakeElement({ tagName: 'BUTTON' }))).toBe(false);
  });

  it('target が無い（null）場合も落ちずに false を返す', () => {
    expect(isEditableTarget(null)).toBe(false);
  });
});

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

describe('formatWaitingSince', () => {
  const NOW = Date.UTC(2026, 6, 28, 12, 0, 0);

  it('「あなたの番」になってからの経過を「待たせています」の形にする', () => {
    // formatElapsed 自体（秒/分/時間の切り替え）は既存の実装をそのまま使うので、
    // ここでは「待たせています」という文言が付くことだけを確認する。
    expect(formatWaitingSince(NOW - 3 * 60_000, NOW)).toBe('3分0秒待たせています');
  });

  it('セッション起動からの通算（formatElapsed）とは別の起点を使う', () => {
    // 遷移直後（sinceMs === nowMs）は「0秒待たせています」になる。
    // これが「37時間28分」のような通算表示に化けないことが、この関数を足した理由そのもの。
    expect(formatWaitingSince(NOW, NOW)).toBe('0秒待たせています');
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
