// アプリ全体のキーボードショートカット判定。
//
// Cmd（metaKey）系の組み合わせだけを対象にする。Ctrl+C など端末本来のキー入力とは
// 絶対に衝突しない設計にするため、ctrlKey が同時に押されている場合は無条件で無視する。
// altKey は **metaKey が同時に押されている場合に限って** 許可する。
//
// 理由: macOS では Option+英数字キーは特殊文字の入力に使われる（例: Option+e は
// アクセント記号を合成する dead key、Option+u はウムラウトの合成キー、Option+s は ß）
// ため、Option 付きの英数字キーをショートカットとして横取りすると文字入力そのものを壊す。
// **ただしこの合成が起きるのは Command が押されていないときだけ**で、
// `Cmd+Option+英字` はどのキーボードレイアウトでも文字を生成しない
// （macOS のキーバインドとしても `Cmd+Option+*` はアプリのコマンド専用の帯域）。
// したがって「metaKey が必須」というこのファイルの大前提が、そのまま dead key を
// 壊さない保証になっている。かつては矢印キーだけを例外にしていたが、
// **その制限は metaKey 必須のガードと重複していただけ**なので Issue #20 PR 15
// （サイドバーの折りたたみ = `Cmd+Option+S`）で外した。
//
// 一方、`Option+←/→`（Cmd 無し）は Terminal.app / iTerm2 / シェルの readline /
// 一般的な Cocoa のテキスト編集コンテキストで「単語単位のカーソル移動」として
// 広く使われている慣習で、ここは今までどおり一切横取りしない
// （`passesModifierGate` が metaKey を必須にしているため自動的にそうなる）。
//
// **Option を押しながらの英字キーは `e.key` で判定してはいけない。** macOS では
// `e.key` に合成後の文字（Option+s なら `ß`）が入りうるため、`Cmd+Shift+]` /
// `Cmd+Shift+[` と同じ理由で **物理キーの位置を表す `e.code`** で判定する。
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
 * - altKey は metaKey が必須である以上そのまま許可してよい（`Cmd+Option+*` は
 *   dead key の合成を起こさない。冒頭コメント参照）。Issue #20 PR 15 まで
 *   「矢印キー以外は false」という追加の制限があったが、metaKey 必須の条件と
 *   重複しており、`Cmd+Option+英字` を1つも割り当てられない副作用だけがあった
 */
export function passesModifierGate(
  e: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'key'>,
): boolean {
  if (!e.metaKey || e.ctrlKey) return false;
  return true;
}

export function matchShortcut(e: KeyboardEvent): ShortcutAction | null {
  if (!passesModifierGate(e)) return null;

  // Cmd+Option+* の割り当て。shiftKey が同時に付いた組み合わせ
  // （Cmd+Shift+Option+*）は未定義のまま素通しする。
  if (e.altKey) {
    if (e.shiftKey) return null;
    // サイドバーの表示/非表示（Cmd+Option+S。Issue #20 K-1）。
    //
    // **`e.key` ではなく `e.code` で判定する。** macOS では Option を押しながらの
    // 英字キーは合成後の文字（Option+s なら `ß`）が `e.key` に入りうるため、
    // `key.toLowerCase() === 's'` では拾えないことがある。`Cmd+Shift+]` /
    // `Cmd+Shift+[` を `.code` で判定しているのとまったく同じ理由
    // （物理キーの位置は修飾キーとレイアウトに影響されない）。
    if (e.code === 'KeyS') return { type: 'toggle-sidebar' };
    // タブそのものを閉じる（Issue #120 周1）。
    //
    // `Cmd+W` は `close-pane`（下）で、**残るペインが1枚ならタブごと閉じる**。
    // つまり分割していないタブでは macOS 標準どおりに振る舞う。だが
    // **分割中のタブを閉じるにはペインの枚数ぶん押す必要があった**（他ターミナルの
    // 筋肉記憶では `Cmd+W` 一発でタブが消えるので、「閉じたつもりが半分残る」）。
    // `Cmd+Option+W` を足して1手で閉じられるようにする。
    // 2つ以上の PTY を一度に閉じるので、App.tsx 側の確認ダイアログを必ず通る。
    if (e.code === 'KeyW') return { type: 'close-tab' };
    // Cmd+Option+矢印: ペイン間移動（Issue #56 PR 8。design-review.md 提案 B'）。
    switch (e.key) {
      case 'ArrowUp':
        return { type: 'move-pane-focus', direction: 'up' };
      case 'ArrowDown':
        return { type: 'move-pane-focus', direction: 'down' };
      case 'ArrowLeft':
        return { type: 'move-pane-focus', direction: 'left' };
      case 'ArrowRight':
        return { type: 'move-pane-focus', direction: 'right' };
      default:
        return null;
    }
  }

  const key = e.key.toLowerCase();

  if (e.shiftKey) {
    // ペインの最大化トグル（Issue #56 PR 8。design-review.md 提案 I）。
    // ドラッグ 2〜5回/日 に対し最大化 10〜30回/日（ヘビーユーザーの実測）。
    if (key === 'enter') return { type: 'toggle-maximize-pane' };
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
    // 次の「あなたの番」のタブへ逆順でジャンプ（Cmd+Shift+J。Issue #20 J）。
    if (key === 'j') return { type: 'jump-your-turn-tab', direction: 'backward' };
    // 次/前のタブ（Cmd+Shift+] / Cmd+Shift+[。Issue #20 J、iTerm2・Ghostty・
    // Chrome 共通の筋肉記憶）。
    //
    // **`.key` ではなく `.code` で判定する。** Shift を押すと US 配列では
    // `[` は `{`、`]` は `}` という別の文字として `.key` に入るため、
    // 他のキー（`c` / `e` / `g` / `d` 等）と同じように `key.toLowerCase()` を
    // 比較する書き方ではこの2キーだけ拾えない。`.code` は Shift の有無や
    // レイアウトに関わらず物理キーの位置を表すため、`Cmd+]` / `Cmd+[`
    // （`next-pane` / `previous-pane`）と同じ物理キーに Shift を足しただけ、
    // という意図をそのままコードに落とせる。
    if (e.code === 'BracketRight') return { type: 'next-tab' };
    if (e.code === 'BracketLeft') return { type: 'previous-tab' };
    return null;
  }

  if (key === 't') return { type: 'new-shell-tab' };
  // Cmd+W は「ペインを閉じる」（意味変更。design-review.md「確定している仕様」）。
  // **残るペインが1枚ならタブごと閉じる**ので、分割していないタブでは
  // macOS 標準どおりに振る舞う。分割中のタブを1手で閉じるキーは
  // `Cmd+Option+W`（上の altKey 分岐。Issue #120 周1 で追加）。
  // `Cmd+Shift+W` は macOS 全域で「ウィンドウを閉じる」と学習されているので使わない。
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
  // ターミナルのフォントサイズ（Issue #120 周1）。
  //
  // **`0` はここで拾う。上のタブ切替の `/^[1-9]$/` を `[0-9]` に広げてはいけない**
  // （`Cmd+1` が index 0 の約束なので、`0` を入れると index が -1 になる）。
  //
  // `Cmd+=` は macOS では Shift 無しで `=`、Shift 付きで `+` が来る。
  // どちらも「拡大」として受ける（Shift 付きは上の e.shiftKey 分岐より前には
  // 来ないので、ここでは `=` だけを見る。`+` は shift 分岐側で拾う）。
  //
  // **Electron の `role: 'zoomIn' / 'zoomOut' / 'resetZoom'` とは別物。**
  // あちらは Renderer 全体（サイドバーもタブバーも）の拡大率で、`config.json` に
  // 保存されない。同じキーが2系統から発火しないよう、menu.ts 側で
  // アクセラレータを潰してある。
  if (key === '=') return { type: 'adjust-font-size', adjustment: 'increase' };
  if (key === '-') return { type: 'adjust-font-size', adjustment: 'decrease' };
  if (key === '0') return { type: 'adjust-font-size', adjustment: 'reset' };
  // 次/前のペイン（Issue #56 PR 8。design-review.md 提案 B'）。
  // Cmd+Option+矢印 を「併設」する第一のキー。2ペインでは「どっちの方向か」の
  // 判断も要らないため、こちらを主に使う想定（40〜80回/日で最も効く）。
  if (key === ']') return { type: 'next-pane' };
  if (key === '[') return { type: 'previous-pane' };
  // 次の「あなたの番」のタブへジャンプ（Cmd+J。Issue #20 J）。想定 100〜200回/日、
  // 1日 200〜600手の削減。逆順（Shift 付き）は上の e.shiftKey 分岐にある。
  if (key === 'j') return { type: 'jump-your-turn-tab', direction: 'forward' };
  // 直前のタブへ戻る（Cmd+E。Issue #20 J）。Cmd+Shift+E は上で gemini の起動に
  // 割り当て済みだが、Shift の有無で別の組み合わせなので衝突しない。
  //
  // **macOS 標準（Use Selection for Find）とは衝突している。残す判断をした**
  // （Issue #120 周1）。上の Cmd+Shift+G の自戒コメントと同じ型の衝突だが、
  // **壊れ方の重さが違う。**
  //
  // - #62（`Cmd+Shift+G` が gemini 起動）: 押すと**本物の gemini が1本余計に起動する**。
  //   ユーザーはそれを見つけて kill しなければならず、自分では元に戻せない
  // - `Cmd+E`: タブが切り替わるだけで、**これはトグルなのでもう一度押せば戻る**
  //   （README「2回押すと直近2枚をトグル」）。誤爆が自己修復する
  //
  // 返すなら `last-active-tab` をどこかへ動かすことになるが、代替の
  // `Cmd+Shift+英数字` はどれも語呂が無く覚えられない。**覚えられないキーは
  // 使われないので、機能を残したことにならない。** 失うもの（1日80〜120回の操作）が
  // 得るもの（自己修復する誤爆の解消）より大きいと判断した。
  if (key === 'e') return { type: 'last-active-tab' };

  return null;
}
