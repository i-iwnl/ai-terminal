// アプリ全体のキーボードショートカット判定。
//
// Cmd（metaKey）系の組み合わせだけを対象にする。Ctrl+C など端末本来のキー入力とは
// 絶対に衝突しない設計にするため、ctrlKey が同時に押されている場合は無条件で無視する。
// altKey も原則同様に無視するが、**矢印キー（ArrowUp/Down/Left/Right）だけは例外**にする。
//
// 理由: macOS では Option+英数字キーは特殊文字の入力に使われる（例: Option+e は
// アクセント記号を合成する dead key、Option+u はウムラウトの合成キー）ため、
// Option 付きの英数字キーをショートカットとして横取りすると文字入力そのものを壊す。
// 一方、矢印キーは Option と組み合わせても文字を生成しない純粋なナビゲーションキーで、
// `Option+←/→` は Terminal.app / iTerm2 / シェルの readline / 一般的な Cocoa の
// テキスト編集コンテキストで「単語単位のカーソル移動」として広く使われている
// 既存の慣習でもある。この慣習と衝突しないよう、`matchShortcut` は `metaKey` が
// 付いていない `Option+矢印` には一切反応しない（後述のガードを参照）。
// `Cmd+Option+矢印` は Issue #56（ターミナル分割表示）でペイン間移動に使う計画があり、
// そのための地ならしとしてここでガードだけを緩めておく（実際に何の操作を割り当てるかは
// 後続 PR の担当。このファイルでは AppAction を増やさない）。
//
// **キーを実際に拾うのはここ1箇所。** メニュー（src/main/menu.ts）は同じキーを
// 表示するだけで登録しない（registerAccelerator: false）。両方が登録すると二重発火する。
// 操作の語彙は src/shared/ipc.ts の AppAction が唯一の正。

import type { AppAction } from '@shared/ipc';

export type ShortcutAction = AppAction;

/**
 * このキーイベントの発生元が「編集中の入力欄」で、アプリのショートカットとして
 * 先取りしてはいけないかを判定する。
 *
 * タブ名編集（TabBar.tsx の `.tab-bar__title-input`）や履歴タイトル編集
 * （HistoryList.tsx の `.history-item__title-input`）にフォーカスがある状態で
 * Cmd+W 等を押すと、名前を打っている途中でタブが閉じる・PTY が増えるといった
 * 事故になる（Issue #63）。ここではその防止のために「編集中」を判定する。
 *
 * 判定は DOM の型と属性だけを見て行い、React や window には依存させない。
 * こうしておくと単体テストで素の DOM 要素（を模した最小限のオブジェクト）を
 * 組み立てるだけで検証できる。unit テストは environment: 'node'（jsdom を使わない）
 * で動くため、`instanceof HTMLElement` のような実 DOM クラスへの依存は使えない。
 * そのため実装は duck typing（必要なプロパティ・メソッドが生えているかだけを見る）
 * にしてある。ブラウザの実 DOM 要素はここで見ているプロパティを当然すべて持つので、
 * 実行時の挙動は instanceof で書いた場合と変わらない。
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (target === null || typeof target !== 'object') return false;
  // any は使わず、必要なプロパティだけを見るための最小限の形に絞る。
  const el = target as {
    classList?: { contains(name: string): boolean };
    closest?: (selector: string) => Element | null;
    isContentEditable?: boolean;
    tagName?: string;
  };

  // **最重要**: xterm.js はターミナルへのキー入力（IME 含む）を受けるために、
  // 画面外の <textarea> を常時フォーカスさせている。つまりターミナルを操作している
  // 間、document.activeElement は常にこの textarea になる。素朴に「input /
  // textarea なら編集中」と判定すると、ターミナル操作中は常に編集中とみなされて
  // **アプリのショートカットが1つも効かなくなる**。
  //
  // xterm はこの textarea に DOM 上の明示的な識別子（data-* 属性等）を公開していない
  // ため、xterm.js が生成時に付与するクラス名 `xterm-helper-textarea` で見分ける
  // （e2e テストも同じクラス名でこの要素を特定しており、このリポジトリでは既に
  // xterm.js の実装詳細として許容している依存）。**xterm.js 側でこのクラス名が
  // 変わると、この除外は静かに効かなくなり、ターミナル操作中にショートカットが
  // 丸ごと死ぬ形で壊れる。** xterm.js のバージョンを上げたときは要確認。
  if (el.classList?.contains('xterm-helper-textarea')) return false;

  // 検索入力欄（TerminalPane.tsx の `.terminal-search input`）はあえて対象外にする。
  // ここは Escape / Enter だけを自前で stopPropagation して処理しており、
  // Cmd+F（検索を閉じる）・Cmd+G / Cmd+Shift+G（次/前を検索）はフォーカスの
  // 有無に関わらずグローバルショートカットとして効くことを意図した設計になっている
  // （useTerminal.ts の findInDirection のコメント参照、S45 のシナリオもこれを前提に
  // している）。ここを編集中として素通しの対象に含めてしまうと、検索語を入力中は
  // Cmd+F で閉じられなくなる（キー入力自体は input が受け取るが、Cmd+F に対応する
  // 処理を input 側は持たないため何も起きなくなる）という新しい壊れ方をする。
  if (el.closest?.('.terminal-search')) return false;

  // contenteditable な要素（Issue #63 の要求）。
  if (el.isContentEditable) return true;

  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
}

/**
 * altKey が同時に押されていても許可する例外キー。
 *
 * 矢印キーは Option と組み合わせても文字を生成しないため、Option+英数字キー
 * （特殊文字の合成に使われる）と違って安全にショートカットへ回せる。
 * 冒頭コメント参照。
 */
function isArrowKey(key: string): boolean {
  return key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight';
}

/**
 * このキーイベントの修飾キーの組み合わせが、アプリのショートカットとして
 * 扱ってよい形かを判定する（`matchShortcut` の入口ガード）。
 *
 * どのキーに何を割り当てるか（`AppAction` への変換）とは独立に、
 * 「そもそも候補として扱ってよいか」だけをここで固定する。こうしておくと、
 * まだ `AppAction` を割り当てていないキー（例: Issue #56 のペイン間移動を
 * 予定している `Cmd+Option+矢印`）についても、ガードの挙動そのものを
 * `matchShortcut` の戻り値（実際の割り当てが無ければ常に null）を介さずに
 * 直接テストできる。`resizeGate.ts` の `shouldSendResize` などと同じ、
 * 判定だけを持つ小さな純粋関数として切り出す形に揃えてある。
 *
 * - metaKey が無ければ常に false（Cmd 無しのキーは触らない）
 * - ctrlKey が同時なら常に false（Ctrl+C 等、端末本来の入力と衝突しない）
 * - altKey が同時なら、矢印キー以外は false（Option+英数字は特殊文字の合成に使われる。
 *   矢印キーは文字を生成しないため例外にする。冒頭コメント参照）
 */
export function passesModifierGate(
  e: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'key'>,
): boolean {
  if (!e.metaKey || e.ctrlKey) return false;
  if (e.altKey && !isArrowKey(e.key)) return false;
  return true;
}

export function matchShortcut(e: KeyboardEvent): ShortcutAction | null {
  if (!passesModifierGate(e)) return null;

  const key = e.key.toLowerCase();

  if (e.shiftKey) {
    // AI CLI の起動は Cmd+Shift 系に置く。
    // Cmd+K は iTerm2 / Terminal.app / Ghostty のいずれでも「画面を消去」で、
    // ここを奪うと**クリアのつもりで押した人が本物の claude を1本余計に起動する**。
    if (key === 'c') return { type: 'new-claude-tab' };
    // gemini は Cmd+Shift+E（g-E-mini の E）。
    //
    // 以前は Cmd+Shift+G だったが、これは Safari / Xcode / TextEdit など macOS 全域で
    // 「前を検索」の標準キーで、検索中に反射で押すと**本物の gemini が1本余計に
    // 起動する**（Issue #62）。Cmd+K を画面消去に残した理由（クリアのつもりで
    // claude を起動させない）とまったく同じ型の事故で、gemini 側だけ見落としていた。
    // Cmd+Shift+G は下で「前を検索」に明け渡し、本来の意味に戻す。
    if (key === 'e') return { type: 'new-gemini-tab' };
    // 前を検索。上の理由により Cmd+Shift+G を gemini の起動から取り戻す。
    if (key === 'g') return { type: 'find-previous' };
    // 下に分割（Issue #56 PR 4。design-review.md 提案 B'）。
    if (key === 'd') return { type: 'split-pane', dir: 'column' };
    return null;
  }

  if (key === 't') return { type: 'new-shell-tab' };
  // Cmd+W は「ペインを閉じる」（意味変更。design-review.md「確定している仕様」）。
  // タブそのものを閉じる操作（close-tab）はメニュー専用になり、キーは持たない
  // （Cmd+Shift+W は macOS 全域で「ウィンドウを閉じる」と学習されているため
  // 新設しない）。
  if (key === 'w') return { type: 'close-pane' };
  // 右に分割。
  if (key === 'd') return { type: 'split-pane', dir: 'row' };
  if (key === 'f') return { type: 'toggle-search' };
  // 次を検索。Safari / Xcode / TextEdit と同じ、macOS 全域の「次を検索」キー。
  if (key === 'g') return { type: 'find-next' };
  if (key === 'k') return { type: 'clear-terminal' };
  // Cmd+, は macOS で「アプリの環境設定」の標準ショートカット
  if (key === ',') return { type: 'toggle-settings' };
  if (/^[1-9]$/.test(e.key)) return { type: 'switch-tab', index: Number(e.key) - 1 };

  return null;
}
