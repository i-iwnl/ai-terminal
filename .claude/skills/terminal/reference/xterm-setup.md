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

## 起動後にコンテキストを失っても DOM レンダラへ落とす（Issue #167）

**初期化に成功しても、あとから失われる。** このアプリは全タブ・全ペインを同時にマウントしたまま（`visibility` だけで切り替える）ので、**WebGL コンテキストがペイン数ぶん同時に生きる**。Chromium の1レンダラあたりの上限は16前後で、超えると古いものから黙って失われる。

**放置したときの壊れ方が特徴的。** キャンバスは真っ白になるが、**a11y の DOM は生き残る**。支援技術には読めていて、**晴眼の利用者にだけ主コンテンツが消える**。

`useTerminal.ts` は `onContextLoss` で `dispose()` する。xterm がコアの既定レンダラ（DOM）へ差し替え、`handleResize` まで行う（`WebglAddon.activate` の `toDisposable`）。**WebGL へ戻す試みはしない**（文字が出続けることが最優先）。

- 発火は `webglcontextlost` の**3秒後**（`webglcontextrestored` を待つ猶予。`WebglRenderer.ts`）。復帰すれば発火しない
- 関門は **S94**（`WEBGL_lose_context` 拡張で意図的に失わせ、`.xterm-rows` に文字が戻ることを見る）
- ⛔ **`.xterm-screen` の canvas の1枚目を掴まない。** `.xterm-link-layer`（2D コンテキスト）が先に並んでいる。**WebGL コンテキストを持つ1枚を探し当てる**

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

## 入力欄の名前は `Terminal.strings` では付けられない（static）

`.xterm-helper-textarea` の既定のアクセシブル名は英語の `Terminal input` で、
**全インスタンス共通**。分割すると支援技術のローターに同じ名前が並び、
**どちらの端末に入力しているか区別できない**（Issue #150 で実測）。

⛔ **`Terminal.strings.promptLabel` で直さない。** あれは **static プロパティ**なので

- インスタンスごとに別の値を持てない
- ペイン名のリネームにも cwd の追従にも乗らない

**textarea へ直接 `aria-label` を張る。** `term.textarea` は `term.open()` のあとに生える。

```ts
useEffect(() => {
  termRef.current?.textarea?.setAttribute('aria-label', options.inputLabel);
}, [options.inputLabel]);
```

**名前は「ペイン自身の名前」を使い回す**（`tabs/paneHeader.ts`）。
ここで別の組み立て方をすると、同じ1つのペインに名前が2通りできる。

⚠ **フォント・テーマの effect と混ぜない。** 名前が変わるのはリネームや cwd の追従で、
フォントとは別のタイミング。依存配列を混ぜると片方が動くたびに両方を書き直すことになる。

⚠ **分割直後の2枚は名前が同じで正しい**（同じ種別・同じ cwd）。区別は利用者が
ペインに名前を付けて作る。**「名前が付いた」だけを見る検査は、
全ペインに同じ名前を付ける実装でも通る**ので、リネーム後に別々になるところまで見る。


## 代替画面バッファでのホイールは、自前で行数ぶんの矢印に変換する（xterm 6 の退化）

**xterm.js 6.0.0 は、スクロールバックを持たないバッファ（= 代替画面）でホイールを受けたとき、
矢印キーを1個しか送らない。** `CoreBrowserTerminal.ts` の wheel ハンドラは
`coreMouseService.consumeWheelEvent()` でスクロール行数を計算しておきながら、
**0 かどうかの判定にしか使っていない**。上流のコメント自身が退化を自認している:

> This used implementation used get the actual lines/partial lines scrolled from the
> viewport but since moving to the new viewport implementation has been **simplified to
> simply send a single up or down sequence**.

5系は `for (let i = 0; i < Math.abs(amount); i++)` で行数ぶん送っていた。

**このアプリでは常時踏む。** `useTmux` の既定が true で claude / gemini タブを全部
tmux でラップするため、**AI タブは必ず代替画面バッファ**にいる。実測（2026-08-07、
行高 15.28px）:

| | ホイール1ノッチ（deltaY=100） |
|---|---|
| xterm 既定 | **1行** |
| 自前ハンドラ | **6行**（100 ÷ 15.28 = 6.5） |

対処は `term.attachCustomWheelEventHandler()`（`useTerminal.ts`）。判定は
`wheelScroll.ts` の純粋関数で、単体テストが「1イベント = 矢印1個」への逆戻りを検出する。

### ⛔⛔ カスタムハンドラは「マウス報告 ON でも呼ばれる」（#251 で訂正）

**ここに「マウス報告 ON なら来ないので `mouseTrackingMode` を自前で見るな」と
書いてあったが、誤りだった。** その記述のせいで claude / gemini タブのホイールが
**マウス報告ごと握り潰され、矢印キーの連打に化けていた**（#238 -> #251）。

xterm.js 6.0.0 の wheel の経路は**2本ある**。

| 経路 | 走る条件 | カスタムハンドラ |
|---|---|---|
| 要素の `wheel` リスナー | `requestedEvents.wheel` が無い（マウス報告 OFF / `x10`）。無いときだけ `_customWheelEventHandler` -> スクロールバックが無ければ矢印1個 | 呼ぶ |
| `eventListeners.wheel` -> `sendEvent()` | マウス報告 ON でホイールを含むプロトコル | **`case 'wheel':` の冒頭で呼び、`false` を返すと報告を送らずに return する** |

```ts
case 'wheel':
  if (self._customWheelEventHandler && self._customWheelEventHandler(ev as WheelEvent) === false) {
    return false;   // ← ここでマウス報告が消える
  }
```

**claude / gemini は起動時に必ず `ESC[?1000h ESC[?1002h ESC[?1003h ESC[?1006h` を出す**
（pty で実測。tmux 経由でも外側の端末まで素通しされる）。つまり AI タブは**常に**
下の経路に落ちる。CLI 側は同方向の矢印を 100ms 以内に 8 本以上受け取ると
`Scroll wheel is sending arrow keys · use PgUp/PgDn to scroll` を出す。

**判定は `wheelScroll.ts` の `shouldConvertWheelToArrows` が唯一の正。**
ホイールを含むプロトコル（`vt200` / `drag` / `any`）では介入しない。

⚠ **ただし `x10` まで除外しないこと。** `X10` の `events` は `DOWN` だけでホイールを
含まないので、除外すると xterm 既定の「矢印1個」に落ちて**この節の本題ごと逆戻り**する。
`none` / `x10` では変換を続ける。

⭐ **実機での対照実験（2026-08-13 / claude 2.1.229）**: ガードを外したビルドでは
ホイール3回で上の通知が出て**入力欄が `History 100/100` に飛んだ**（履歴送りになる）。
ガードを入れたビルドでは転写が正しくスクロールし、`Jump to bottom` が出た。

⛔ **`event.preventDefault()` を省かないこと。** xterm はカスタムハンドラが `false` を
返したとき `cancel()` を呼ばずに抜けるので、抑止はこちらの責任。省くと親要素がスクロールしうる。

⚠ **通常バッファには介入しない。** そちらは `Viewport` が `scrollSensitivity` ごと
正しく処理しており壊れていない。判定は `term.buffer.active.type === 'alternate'`
（`hasScrollback` は公開 API に無い）。
