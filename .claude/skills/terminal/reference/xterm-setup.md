# xterm.js のアドオン構成とキー入力の扱い

`@xterm/xterm` のセットアップに関する知識。実装は [../../../../src/renderer/src/terminal/useTerminal.ts](../../../../src/renderer/src/terminal/useTerminal.ts)。

## アドオン一覧

| アドオン | 何のために必要か |
|---|---|
| `@xterm/addon-fit` | コンテナのサイズにフィットさせ、リサイズのたびに PTY 側へも `resize` を伝える。無いとウィンドウリサイズに追従しない |
| `@xterm/addon-webgl` | 描画を高速化する。`vim` / `htop` のような高頻度描画の TUI で体感速度に効く |
| `@xterm/addon-unicode-graphemes` | 日本語・絵文字の文字幅計算に**必須**。入れないと全角文字を含む出力で表示がずれる |
| `@xterm/addon-search` | ターミナル内検索（`Cmd+F`） |
| `@xterm/addon-clipboard` | コピー / ペースト |
| `@xterm/addon-web-links` | URL をクリックしてブラウザで開く |

`@xterm/addon-unicode-graphemes` を読み込むだけでは不十分で、`term.unicode.activeVersion` にこのアドオンが登録する Unicode バージョン文字列（`useTerminal.ts` の `GRAPHEME_UNICODE_VERSION`）を明示的に設定する必要がある。設定を忘れると文字幅計算がデフォルトのままになり、全角文字がずれる。

**旧 `xterm`（5.3.0 系）パッケージは deprecated。`@xterm/` スコープ付きのみを使う。** 根拠と経緯はルート CLAUDE.md の「技術スタック」を参照する（ここでの二重記載はしない）。

## WebGL アドオンは初期化失敗を許容する

`WebglAddon` は環境によって初期化に失敗することがある（GPU ドライバやサンドボックス設定に依存）。`useTerminal.ts` では `term.loadAddon(new WebglAddon())` を try/catch で囲み、失敗時は警告ログを出すだけで続行する。ここで例外を投げっぱなしにすると、WebGL が使えない環境でターミナルそのものが起動しなくなる。

## キーボードショートカットと端末入力の共存

アプリのショートカット判定（[../../../../src/renderer/src/lib/shortcuts.ts](../../../../src/renderer/src/lib/shortcuts.ts) の `matchShortcut()`）は `metaKey`（Cmd）系の組み合わせだけを対象にし、`ctrlKey` / `altKey` が同時に押されている場合は判定自体を行わない。これにより `Ctrl+C` のような端末本来のキー入力を一切妨げない設計になっている。

判定は二重に防御されている。

1. ウィンドウのグローバル keydown リスナーが capture フェーズで先に拾い、ショートカットに一致すれば `stopPropagation` する
2. それでも xterm まで届いた場合に備え、`term.attachCustomKeyEventHandler()` で `matchShortcut()` が非 null を返すキー入力は xterm 側にも処理させない（`false` を返す）

ショートカットを追加・変更するときは `shortcuts.ts` の `matchShortcut()` だけを直せばよい。`useTerminal.ts` 側のハンドラは `matchShortcut()` の結果を見るだけで、キーの判定ロジックを重複させていない。

## タブ切り替えで Terminal インスタンスを破棄しない

タブを切り替えるとき、非表示になる側の `Terminal` インスタンスを破棄してはいけない。DOM コンテナを `visibility: hidden` 等で隠すだけにし、`term.dispose()` は呼ばない。破棄すると scrollback を含めた表示内容が失われ、タブに戻ったときに空のターミナルになる。

## プログラム的な `focus()` のこだまを、ペイン活性化の入力にしない

分割中のペイン（`TerminalPane.tsx`）は「アクティブになったら `handle.focus()` を呼ぶ」effect と、「フォーカスが入ったらアクティブにする」`onFocusCapture` の**両方**を持つ。この2つは**フィードバックループ**になっていて、負荷下で壊れる。

Issue #120 C-1 の実測（`performance.now()`、CPU を16本のビジーループで埋めた状態、60起動中4件で再現）:

```
297.90 keydown ]                       ← このとき activeElement は <body>
298.00 setActivePaneInTab pane=OLD     ← キーボード由来。ここまでは正しい
302.10 effect-active OLD active=false  ← 分割コミットの passive effect が「今」走る
305.70 effect-active NEW active=true
305.80 handle.focus()
306.40 onFocusCapture NEW
306.50 setActivePaneInTab pane=NEW     ← こだまが OLD を引き戻して負ける
```

**原因は「xterm がまだマウント中」ではなく、React 18 の passive effect のフラッシュがスケジューラ経由で遅れること。** DOM のコミット（`is-active` クラス）は同期で入るので、分割は**画面にもテストにも見えている**のに `handle.focus()` だけが後から走る。

**effect が呼ぶ `focus()` は「そのペインが既に active だから」呼ばれている。** つまりそのこだまが運ぶ情報は常にゼロで、捨てても失うものが無い。一方でこだまが遅れて届くと、その間に入った本物の意思（キーボード操作）を上書きする。**情報を持たない信号が、情報を持つ信号に勝てる**のが不具合の本体。

対処は `src/renderer/src/terminal/focusEcho.ts` の `createFocusEchoGate()`。`run()` の内側で起きた focus だけを落とし、**クリック・ドロップ由来の focus は通す**（そちらは本物の意思）。

**待ちを増やすテストでは直らない。** `S61-pane-navigation.spec.ts` は既に DOM の `is-active` を待っており、その待ちが通った**後**に競合が起きている。同型の配線を足すときは、次の2つを分けて考えること。

- **プログラム的 `focus()`** = 状態の結果。状態へ戻してはいけない
- **ユーザー由来の focus** = 状態への入力。通す

**人工的な遅延（`setTimeout` やメインスレッドの占有）では再現しない。** ビジー待ちは effect のフラッシュも一緒に遅らせるだけで順序が入れ替わらない。再現には**本物の負荷**（スケジューラが割り込まれる状況）が要る。
