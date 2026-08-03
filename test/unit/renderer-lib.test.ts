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
import {
  isEditableTarget,
  matchShortcut,
  passesModifierGate,
} from '../../src/renderer/src/lib/shortcuts';

/** KeyboardEvent の必要な部分だけを組み立てる（DOM を用意せずに判定を試す）。 */
function keyEvent(init: {
  key: string;
  /**
   * 物理キーの位置（Shift の有無やキーボードレイアウトに依存しない）。
   * Cmd+Shift+[ / Cmd+Shift+] の判定にだけ使う（shortcuts.ts のコメント参照）。
   * 省略時は使わないテストがほとんどなので任意にしてある。
   */
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}): KeyboardEvent {
  return {
    key: init.key,
    code: init.code ?? '',
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

describe('passesModifierGate', () => {
  // matchShortcut の入口ガードそのものを、AppAction の割り当て有無から切り離して固定する。
  // ここが「矢印キーに限って altKey を許可する」変更の本体。
  // shortcuts.ts のガード変更だけを revert すると、1番目のケースがここで赤くなる
  // （matchShortcut 経由の toBeNull() 比較だと revert 前後で結果が変わらず検出できない）。

  it('Cmd+Option+矢印 はガードを通す（これがガード変更そのもの）', () => {
    expect(
      passesModifierGate({ metaKey: true, ctrlKey: false, altKey: true, key: 'ArrowLeft' }),
    ).toBe(true);
    expect(
      passesModifierGate({ metaKey: true, ctrlKey: false, altKey: true, key: 'ArrowRight' }),
    ).toBe(true);
    expect(
      passesModifierGate({ metaKey: true, ctrlKey: false, altKey: true, key: 'ArrowUp' }),
    ).toBe(true);
    expect(
      passesModifierGate({ metaKey: true, ctrlKey: false, altKey: true, key: 'ArrowDown' }),
    ).toBe(true);
  });

  // Issue #20 PR 15（サイドバーの折りたたみ = Cmd+Option+S）でここが変わった。
  // それまでは「矢印キー以外は Cmd+Option でもガードを通さない」ことを固定していたが、
  // その制限は **metaKey 必須のガードと重複していただけ** だった
  // （dead key の合成が起きるのは Command が押されていないときだけ）。
  // **ガードを元に戻すと、このケースがここで赤くなる。**
  it('Cmd+Option+英字 はガードを通す（PR 15 でここが変わった）', () => {
    expect(passesModifierGate({ metaKey: true, ctrlKey: false, altKey: true, key: 's' })).toBe(
      true,
    );
    // 割り当ての無い英字でもガード自体は通す（何を割り当てるかは matchShortcut の担当）。
    expect(passesModifierGate({ metaKey: true, ctrlKey: false, altKey: true, key: 't' })).toBe(
      true,
    );
  });

  it('Cmd 無しの Option+矢印 はガードを通さない（端末の単語移動と衝突しない）', () => {
    expect(
      passesModifierGate({ metaKey: false, ctrlKey: false, altKey: true, key: 'ArrowLeft' }),
    ).toBe(false);
  });

  it('ctrlKey が同時なら矢印キーの例外に関わらずガードを通さない', () => {
    expect(
      passesModifierGate({ metaKey: true, ctrlKey: true, altKey: true, key: 'ArrowRight' }),
    ).toBe(false);
  });
});

describe('matchShortcut', () => {
  it('Cmd 無しのキーはすべて素通しする', () => {
    // ターミナルへの入力を奪わないための最重要の性質
    expect(matchShortcut(keyEvent({ key: 't' }))).toBeNull();
    expect(matchShortcut(keyEvent({ key: 'c', ctrlKey: true }))).toBeNull();
    expect(matchShortcut(keyEvent({ key: '1' }))).toBeNull();
  });

  it('Cmd と Ctrl の同時押しは対象外にする', () => {
    expect(matchShortcut(keyEvent({ key: 't', metaKey: true, ctrlKey: true }))).toBeNull();
  });

  // ガードは通すようになった（上の passesModifierGate 参照）が、割り当てが無い
  // Cmd+Option+英字 は今までどおり null のまま素通しする。
  it('割り当ての無い Cmd+Alt+英字 は null のまま素通しする', () => {
    expect(matchShortcut(keyEvent({ key: 't', code: 'KeyT', metaKey: true, altKey: true }))).toBeNull();
    // **KeyW は Issue #120 周1 で `close-tab` に割り当てた**ので、
    // 「割り当ての無い」例としては使えなくなった（下の専用テストが固定する）。
    expect(matchShortcut(keyEvent({ key: 'q', code: 'KeyQ', metaKey: true, altKey: true }))).toBeNull();
  });

  // Issue #20 K-1: サイドバーの表示/非表示（Cmd+Option+S）。
  //
  // **判定は `.code`。** macOS では Option を押しながらの英字キーは合成後の文字が
  // `.key` に入りうる（Option+s -> `ß`）。実機でその形になっても拾えることを、
  // `key` に `ß` を入れたケースで固定する（`.key` 判定に書き換えると赤くなる）。
  it('Cmd+Option+S はサイドバーの表示切り替えに割り当たる', () => {
    expect(matchShortcut(keyEvent({ key: 's', code: 'KeyS', metaKey: true, altKey: true }))).toEqual(
      { type: 'toggle-sidebar' },
    );
    expect(
      matchShortcut(keyEvent({ key: 'ß', code: 'KeyS', metaKey: true, altKey: true })),
    ).toEqual({ type: 'toggle-sidebar' });
  });

  // Option 無しの Cmd+S は未定義のまま（保存の標準キーなので、将来別の意味を
  // 割り当てるとしてもここではない）。Shift 付きも未定義。
  it('Cmd+S / Cmd+Shift+Option+S は未定義のまま null を返す', () => {
    expect(matchShortcut(keyEvent({ key: 's', code: 'KeyS', metaKey: true }))).toBeNull();
    expect(
      matchShortcut(keyEvent({ key: 's', code: 'KeyS', metaKey: true, altKey: true, shiftKey: true })),
    ).toBeNull();
  });

  // Issue #56 PR 8: ペイン間移動に Cmd+Option+矢印 を割り当てた。矢印キーだけは
  // altKey ガードの例外にする（矢印キーは Option と組み合わせても文字を生成しない
  // ため、Option+英数字キーと違って安全）。ガードそのものの変更は上の
  // `passesModifierGate` の describe で固定済み。
  //
  // このテストはかつて「まだ操作が割り当たっていないので null を返す」ことを
  // 固定していた（renderer-lib.test.ts の以前のコメント参照）。design-review.md
  // U1 の記録どおり、PR 8 で実際に AppAction を割り当てたことでここが
  // 意図して変わった（この変化に気づけるようにするための記録、という以前の
  // コメントが指していたのがこの変更そのもの）。
  it('Cmd+Option+矢印 は4方向のペイン移動に割り当たる', () => {
    expect(matchShortcut(keyEvent({ key: 'ArrowUp', metaKey: true, altKey: true }))).toEqual({
      type: 'move-pane-focus',
      direction: 'up',
    });
    expect(matchShortcut(keyEvent({ key: 'ArrowDown', metaKey: true, altKey: true }))).toEqual({
      type: 'move-pane-focus',
      direction: 'down',
    });
    expect(matchShortcut(keyEvent({ key: 'ArrowLeft', metaKey: true, altKey: true }))).toEqual({
      type: 'move-pane-focus',
      direction: 'left',
    });
    expect(matchShortcut(keyEvent({ key: 'ArrowRight', metaKey: true, altKey: true }))).toEqual({
      type: 'move-pane-focus',
      direction: 'right',
    });
  });

  // Cmd+Shift+Option+矢印 は未定義のまま素通しする（Cmd+Option+矢印 とは別の
  // 組み合わせで、意図せず何かに割り当たっていないことを固定する）。
  it('Cmd+Shift+Option+矢印 は未定義のまま null を返す', () => {
    expect(
      matchShortcut(keyEvent({ key: 'ArrowUp', metaKey: true, altKey: true, shiftKey: true })),
    ).toBeNull();
  });

  // Cmd が付いていない Option+矢印 は、Terminal.app / iTerm2 / シェルの readline で
  // 「単語単位のカーソル移動」として日常的に使われている。matchShortcut は metaKey を
  // 必須にしているため、矢印キーの例外を足してもこの組み合わせは横取りされないはずで、
  // それをここで固定する（Issue #56 design-review.md の懸念事項）。
  it('Cmd 無しの Option+矢印 は今までどおり素通しする（端末の単語移動と衝突しない）', () => {
    expect(matchShortcut(keyEvent({ key: 'ArrowLeft', altKey: true }))).toBeNull();
    expect(matchShortcut(keyEvent({ key: 'ArrowRight', altKey: true }))).toBeNull();
  });

  // ctrlKey は altKey の例外に関わらず常にガードで弾く（Ctrl+矢印 を分割の機能に使う
  // 計画は無い）。
  it('矢印キーでも Ctrl が同時に押されていれば対象外にする', () => {
    expect(
      matchShortcut(keyEvent({ key: 'ArrowRight', metaKey: true, ctrlKey: true, altKey: true })),
    ).toBeNull();
  });

  it('タブ操作を判定する', () => {
    expect(matchShortcut(keyEvent({ key: 't', metaKey: true }))).toEqual({ type: 'new-shell-tab' });
    // Cmd+W は Issue #56 PR 4 で「ペインを閉じる」に意味が変わった
    // （design-review.md「確定している仕様」。タブそのものを閉じる close-tab は
    // メニュー専用になり、キーを持たない）。
    expect(matchShortcut(keyEvent({ key: 'w', metaKey: true }))).toEqual({ type: 'close-pane' });
    expect(matchShortcut(keyEvent({ key: '3', metaKey: true }))).toEqual({
      type: 'switch-tab',
      index: 2,
    });
  });

  // Issue #56 PR 4: 分割のキー。右は Cmd+D、下は Cmd+Shift+D
  // （design-review.md 提案 B'）。
  it('分割を判定する', () => {
    expect(matchShortcut(keyEvent({ key: 'd', metaKey: true }))).toEqual({
      type: 'split-pane',
      dir: 'row',
    });
    expect(matchShortcut(keyEvent({ key: 'd', metaKey: true, shiftKey: true }))).toEqual({
      type: 'split-pane',
      dir: 'column',
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
    // 添字が -1 になるため、タブ切替は 1〜9 のみを受け付ける。
    // **Issue #120 周1 で Cmd+0 自体は「文字サイズを既定に戻す」になった**ので、
    // null ではなくなっている（`/^[1-9]$/` を `[0-9]` に広げていないことの確認は
    // こちらが本体で、下の専用テストが index の側から固定する）。
    expect(matchShortcut(keyEvent({ key: '0', metaKey: true }))).not.toMatchObject({
      type: 'switch-tab',
    });
  });

  // Issue #56 PR 8（design-review.md 提案 I）: ペインの最大化トグル。
  // ドラッグ 2〜5回/日 に対し最大化 10〜30回/日（ヘビーユーザーの実測）。
  it('Cmd+Shift+Enter でペインの最大化をトグルする', () => {
    expect(matchShortcut(keyEvent({ key: 'Enter', metaKey: true, shiftKey: true }))).toEqual({
      type: 'toggle-maximize-pane',
    });
  });

  // Issue #56 PR 8（design-review.md 提案 B'）: 次/前のペイン。
  // Cmd+Option+矢印 より先に併設される第一のキー（U1 のガード修正に依存しない）。
  it('Cmd+] / Cmd+[ で次/前のペインへ移動する', () => {
    expect(matchShortcut(keyEvent({ key: ']', metaKey: true }))).toEqual({ type: 'next-pane' });
    expect(matchShortcut(keyEvent({ key: '[', metaKey: true }))).toEqual({ type: 'previous-pane' });
  });

  // Issue #20 J（PR 14）: 次の「あなたの番」のタブへジャンプ。Shift で逆順。
  it('Cmd+J / Cmd+Shift+J で「あなたの番」のタブへジャンプする（Shift で逆順）', () => {
    expect(matchShortcut(keyEvent({ key: 'j', metaKey: true }))).toEqual({
      type: 'jump-your-turn-tab',
      direction: 'forward',
    });
    expect(matchShortcut(keyEvent({ key: 'j', metaKey: true, shiftKey: true }))).toEqual({
      type: 'jump-your-turn-tab',
      direction: 'backward',
    });
  });

  // Issue #20 J: 直前のタブへ戻る。Cmd+Shift+E は既に gemini の起動に割り当て済み
  // （このファイルの「AI CLI の起動は Cmd+Shift 系に置く」テスト）なので、
  // Shift 無しの Cmd+E だけがこの操作になることも併せて固定する。
  it('Cmd+E で直前のタブへ戻る（Cmd+Shift+E は gemini の起動のまま衝突しない）', () => {
    expect(matchShortcut(keyEvent({ key: 'e', metaKey: true }))).toEqual({
      type: 'last-active-tab',
    });
    expect(matchShortcut(keyEvent({ key: 'e', metaKey: true, shiftKey: true }))).toEqual({
      type: 'new-gemini-tab',
    });
  });

  // Issue #20 J: 次/前のタブ（iTerm2・Ghostty・Chrome 共通の筋肉記憶）。
  // Cmd+] / Cmd+[（次/前のペイン）とは Shift の有無で衝突しないことも固定する。
  // Shift+[ / Shift+] は US 配列では .key が '{' / '}' になるため、判定には
  // レイアウト非依存の .code（BracketLeft / BracketRight）を使う（shortcuts.ts 参照）。
  it('Cmd+Shift+] / Cmd+Shift+[ で次/前のタブへ移動する（ペイン移動とは衝突しない）', () => {
    expect(
      matchShortcut(keyEvent({ key: '}', code: 'BracketRight', metaKey: true, shiftKey: true })),
    ).toEqual({ type: 'next-tab' });
    expect(
      matchShortcut(keyEvent({ key: '{', code: 'BracketLeft', metaKey: true, shiftKey: true })),
    ).toEqual({ type: 'previous-tab' });
    // Shift 無し（Cmd+] / Cmd+[）は今までどおりペイン移動のまま。
    expect(matchShortcut(keyEvent({ key: ']', code: 'BracketRight', metaKey: true }))).toEqual({
      type: 'next-pane',
    });
    expect(matchShortcut(keyEvent({ key: '[', code: 'BracketLeft', metaKey: true }))).toEqual({
      type: 'previous-pane',
    });
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

describe('matchShortcut: Issue #120 周1 で決めたキー', () => {
  // ## Cmd+E は「残す」判断をした
  //
  // macOS 全域で Cmd+E は「選択部分を検索に使う」（Use Selection for Find）で、
  // このアプリは Cmd+F / Cmd+G / Cmd+Shift+G を既に macOS 標準に揃えている。
  // それでも残したのは、**壊れ方の重さが #62 と違う**から。
  //
  // - #62（Cmd+Shift+G が gemini 起動）: **本物の gemini が1本余計に起動する。**
  //   ユーザーは見つけて kill しなければならず、自分では元に戻せない
  // - Cmd+E: タブが切り替わるだけで、**トグルなのでもう一度押せば戻る**
  //
  // この判断が変わるときは、ここのテストごと書き換えること。
  it('Cmd+E は直前のタブへ戻る（macOS 標準へは返さない判断）', () => {
    expect(matchShortcut(keyEvent({ key: 'e', metaKey: true }))).toEqual({
      type: 'last-active-tab',
    });
    // Shift 付きは gemini の起動（Shift の有無で別の組み合わせ）。
    expect(matchShortcut(keyEvent({ key: 'e', metaKey: true, shiftKey: true }))).toEqual({
      type: 'new-gemini-tab',
    });
  });

  // ## フォントサイズ
  it('Cmd+= / Cmd+- / Cmd+0 がターミナルの文字サイズを動かす', () => {
    expect(matchShortcut(keyEvent({ key: '=', metaKey: true }))).toEqual({
      type: 'adjust-font-size',
      adjustment: 'increase',
    });
    expect(matchShortcut(keyEvent({ key: '-', metaKey: true }))).toEqual({
      type: 'adjust-font-size',
      adjustment: 'decrease',
    });
    expect(matchShortcut(keyEvent({ key: '0', metaKey: true }))).toEqual({
      type: 'adjust-font-size',
      adjustment: 'reset',
    });
  });

  it('Cmd+0 を足してもタブ切替の index が壊れていない', () => {
    // **`/^[1-9]$/` を `[0-9]` に広げてはいけない。** Cmd+1 が index 0 の
    // 約束なので、0 を含めると index が -1 になる。
    expect(matchShortcut(keyEvent({ key: '1', metaKey: true }))).toEqual({
      type: 'switch-tab',
      index: 0,
    });
    expect(matchShortcut(keyEvent({ key: '9', metaKey: true }))).toEqual({
      type: 'switch-tab',
      index: 8,
    });
    // 0 は switch-tab に落ちない。
    expect(matchShortcut(keyEvent({ key: '0', metaKey: true }))).not.toMatchObject({
      type: 'switch-tab',
    });
  });

  // ## 分割中のタブを1手で閉じる
  it('Cmd+Option+W がタブを閉じ、Cmd+W はペインのまま', () => {
    // **`e.code` で判定する。** macOS では Option を押しながらの英字キーは
    // 合成後の文字が `e.key` に入りうる（Option+w は `∑`）。
    // Cmd+Option+S と同じ理由。
    expect(matchShortcut(keyEvent({ key: '∑', code: 'KeyW', metaKey: true, altKey: true }))).toEqual(
      { type: 'close-tab' },
    );
    // Option 無しは従来どおりペインを閉じる（残るペインが1枚ならタブごと閉じる）。
    expect(matchShortcut(keyEvent({ key: 'w', metaKey: true }))).toEqual({ type: 'close-pane' });
    // Shift も付いていたら未定義のまま素通しする（Cmd+Shift+W は macOS 全域で
    // 「ウィンドウを閉じる」なので奪わない）。
    expect(
      matchShortcut(keyEvent({ key: 'w', code: 'KeyW', metaKey: true, altKey: true, shiftKey: true })),
    ).toBeNull();
  });
});
