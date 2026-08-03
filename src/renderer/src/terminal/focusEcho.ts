// プログラム的な `focus()` が跳ね返してくる focus イベント（「こだま」）を
// 「アクティブなペインを変えろ」と読み違えないための門番。純粋な状態機械で、
// DOM にも React にも依存しない（Issue #120 C-1）。
//
// ## 何が起きていたか（観測済み。推測ではない）
//
// `Cmd+D` で分割した直後に `Cmd+]` を押すと、左ペインがアクティブにならない
// ことがあった。`make e2e` の負荷下でのみ再現し、単独実行では通る。
//
// 負荷を人工的にかけて（CPU を 16 本のビジーループで埋め、60 起動）
// `performance.now()` 付きで観測したところ、再現時の順序はこうだった:
//
// ```
// 297.90 keydown ]                       ← このとき activeElement は <body>
// 298.00 setActivePaneInTab pane=OLD     ← キーボード由来。ここまでは正しい
// 302.10 effect-active OLD active=false  ← ★ 分割コミットの passive effect が「今」走る
// 305.70 effect-active NEW active=true   ← ★ 同上
// 305.80 handle.focus()                  ← NEW へプログラム的にフォーカス
// 306.40 onFocusCapture NEW
// 306.50 setActivePaneInTab pane=NEW     ← ★ こだまが OLD を引き戻して負ける
// ```
//
// **原因は「xterm がまだマウント中」ではなく、React 18 の passive effect の
// フラッシュがスケジューラ経由で遅れること。** DOM のコミット（`is-active`
// クラス）は同期で入るので分割は画面にもテストにも見えているのに、その回の
// `handle.focus()` だけが後から走る。負荷が高いほどこの窓が伸び、そこへ
// `Cmd+]` が刺さると、キーボード由来の更新の**後**にこだまが届いて勝つ。
//
// ## なぜ「こだま」を捨ててよいのか
//
// `TerminalPane` が effect で `handle.focus()` を呼ぶのは、**そのペインが
// 既に active だから**。つまりこのこだまが運ぶ情報は「active なペインが
// active である」だけで、常にゼロ。捨てても失うものが無い。
// 一方でこだまが遅れて届くと、その間に入った本物の意思（キーボード操作）を
// 上書きしてしまう。**情報を持たない信号が、情報を持つ信号に勝てる**のが
// 不具合の本体。
//
// **クリック由来の focus は捨てない。** そちらは「このペインを使いたい」という
// 本物の意思で、`onFocusCapture` の本来の目的（Cmd+F / Cmd+W 等のグローバル
// 操作を正しいペインへ向ける）そのもの。門番は `run()` の**内側で起きた
// focus だけ**を落とす。
//
// **待ちを増やすテストでは直らない。** `S61-pane-navigation.spec.ts` は既に
// DOM の `is-active` を待っており、その待ちが通った後に競合が起きている。

/**
 * プログラム的な `focus()` のこだまを1回ぶん飲み込む門番。
 *
 * `focus()` は DOM 仕様上その場で focus イベントを配送する（実測でも
 * 呼び出しから 0.1〜0.6ms、同じタスクの中）。したがって `run()` の呼び出しが
 * 返るまでを「こだまの窓」として閉じれば足りる。**将来 xterm 側が配送を
 * 遅らせるようになったら、この門番は黙って無効になる**（バグが戻るだけで、
 * 誤って本物の focus を捨てることはない）。安全側に倒れる設計。
 */
export interface FocusEchoGate {
  /**
   * プログラム的なフォーカス操作を実行する。この中で起きた focus は
   * `shouldActivate()` が false を返して捨てられる。
   * `focus` が例外を投げても窓は必ず閉じる。
   */
  run(focus: () => void): void;
  /** いま来た focus イベントを「アクティブ変更の意思」として扱ってよいか。 */
  shouldActivate(): boolean;
}

export function createFocusEchoGate(): FocusEchoGate {
  // 真偽値ではなく深さで持つ。入れ子で呼ばれたとき、内側の `run()` を抜けた
  // 時点で門が開いてしまうと、外側の `focus()` のこだまが素通りする。
  // 現状の呼び出し元は1箇所だが、**開きっぱなしより早すぎる開きのほうが
  // 見つけにくい**ので、構造で防いでおく。
  let depth = 0;
  return {
    run(focus: () => void): void {
      depth += 1;
      try {
        focus();
      } finally {
        depth -= 1;
      }
    },
    shouldActivate(): boolean {
      return depth === 0;
    },
  };
}
