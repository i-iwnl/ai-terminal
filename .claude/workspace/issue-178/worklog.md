# Worklog

時系列の作業ログ。**設計判断の根拠**と**学んだ教訓**を中心に記録する。
コード差分は git log を参照、現状の構造は `architecture.md` を参照。

---

## 2026-08-04 - ワークスペース作成と、計画ゲートでの前提の測り直し

### 実施内容

- `.claude/workspace/issue-178/` を作成（overview / architecture / worklog / known-issues）
- Issue #178（束ね）と統合元 #174 を取得し、本文の現状認識を実コードで測り直した
- 触る箇所を実測で特定（行番号ではなく関数名・シンボルで）
  - `setWindowOpenHandler`: `src/` 全体に**0件**（Issue の記述どおり）
  - `WebLinksAddon`: `src/renderer/src/terminal/useTerminal.ts` の `useEffect` 内。
    ハンドラは `(_event, uri) => window.open(uri, '_blank', 'noopener,noreferrer')`
  - ウィンドウ生成点は2つ: `src/main/index.ts` の `createWindow()` と
    `src/main/settings-window.ts` の `openSettingsWindow()`
  - `shell.openExternal` の既存呼び出しは `src/main/menu.ts`（ヘルプ > リポジトリを開く）の1件のみ
- `@xterm/addon-web-links@0.12` の typings を読み、修飾キーの門を addon 側で作れないことを確認

### 設計判断

- **逃がし先は `src/main/external-links.ts` の1関数に集約する**: ウィンドウ生成点が2つあり、
  片方への付け忘れが穴になる。将来ウィンドウが増えたときも「呼ぶ関数が1つある」形が漏れにくい
- **`openExternal` の前にスキームを allowlist で絞る**: URL は PTY 出力（外部）由来。
  `shell.openExternal` は `file://` や任意のカスタムスキームで**他アプリを起動できる**。
  鉄則5（外から来る値は絞り込む）の適用先
- **判定は純粋関数に切り出して `test/unit/` で固定する**: 開いた先（本物のブラウザ）は
  Playwright から観測できない。リポジトリに前例が8つある既定の作法

### 教訓（該当する場合）

- **Issue 本文の現状認識が2点ずれていた**（`loop.md` が「計画書の前提は古くなる」と
  書いているとおり）。
  1. 「設定ウィンドウを `Cmd+W` で閉じられない」-> `SettingsPanel.tsx` が既に処理済み
  2. 「`menu-accelerators.test.ts` が二重発火を固定する」-> 当該テストの冒頭が
     「**`role:` が暗黙に持つ accelerator は対象外**」と自ら明記している
- **`role: 'close'` は「足せば直る」ものではない。** 既定アクセラレータ `Cmd+W` を
  ネイティブ登録するため、Renderer の `close-pane`（`Cmd+W`）と衝突し、
  **押した瞬間にウィンドウごと閉じる**（全タブの PTY が落ちる）。
  `registerAccelerator: false` を付ければ衝突は消えるが、子ウィンドウでも効かなくなるので
  足す意味が消える。**両立しない**

### 次に再開するとき最初に読むべきこと

- `architecture.md` の「5. 計画書の前提と実コードのずれ」。周3（`role: 'close'`）の
  実施可否がユーザー確認待ちで、ここが判断の根拠になっている
- 周1 から着手する。触るのは `src/main/external-links.ts`（新規）/ `src/main/index.ts` の
  `createWindow()` / `src/main/settings-window.ts` の `openSettingsWindow()`
- 追加する台帳エントリは S92（周1）/ S93（周2）。`e2e/scenarios.yml` の現在の最終は S91

---

## 2026-08-04 - 周1・周2 の実装と検証（周3 は見送り）

### 実施内容

- **周1: 外部リンクを既定ブラウザへ逃がす**
  - `src/main/external-links.ts` を新設（`attachExternalLinkHandler` + 純粋関数 `isSafeExternalUrl`）
  - `index.ts` の `createWindow()` と `settings-window.ts` の `openSettingsWindow()` の**両方**から呼ぶ
  - `test/unit/external-links.test.ts`（7ケース）/ `e2e/specs/S92-*.spec.ts` / `scenarios.yml` に S92
  - `test/stubs/electron.ts` に `shell` を追加（import を通すだけの最小の形）
- **周2: リンクの活性化を Cmd+クリックに寄せる**
  - `src/renderer/src/terminal/linkActivation.ts` を新設（純粋関数 `shouldActivateLink`）
  - `useTerminal.ts` の `WebLinksAddon` ハンドラに門を入れる
  - `test/unit/link-activation.test.ts`（5ケース）/ `e2e/specs/S93-*.spec.ts` / `scenarios.yml` に S93
  - `README.md`（「2. 普通のターミナルとして使う」とショートカット表の下）
- **周3: 見送り**（ユーザー確認済み。根拠は `architecture.md` の「5. 計画書の前提と実コードのずれ」）

### 検証

| 段 | 結果 |
|---|---|
| `make check` | 38 files / 555 tests green |
| `make e2e` | 102 passed（S48 / S56 が flaky = リトライで green。単体で回すと2本とも1秒未満で green なので**マシン負荷**。今回の変更とは無関係） |
| `make e2e-lint` | PASS=743 FAIL=0 |
| `make e2e-screenshots-check` | PASS=38 FAIL=0（**UI・CSS・DOM を1行も触っていない**ことの機械的な裏付け。撮り直しは不要） |

**「赤くなるか」を4本とも実測した**（loop.md「空振りする5つの形」）。

| 壊し方 | 結果 |
|---|---|
| `isSafeExternalUrl` の allowlist を緩める | `external-links.test.ts` が 7 件中 5 件で赤 |
| `index.ts` から `attachExternalLinkHandler(win)` を消す | S92 が赤（`npm run build` 前置あり） |
| `settings-window.ts` から同上を消す | S92 が「設定ウィンドウ側に setWindowOpenHandler が付いていない」で赤 |
| `useTerminal.ts` から `shouldActivateLink` の門を消す | S93 が「素のクリックでリンクが開いている」で赤 |

### 実機確認（agent-browser + CDP）

`AI_TERMINAL_DATA_DIR` を渡した隔離環境で起動し、**scratchpad に立てたローカル HTTP サーバ**（`python3 -m http.server 8765`）を開き先にして測った。
**「ブラウザが前に出たか」を目や `lsappinfo` で見ない**（既に前面だと判定できない）。**サーバのアクセスログに GET が届いたか**が唯一の観測点。

| 確認したこと | 結果 |
|---|---|
| 素のクリック（周1 時点） | `GET /aiterm-178-plain-click` がサーバに届く = 既定ブラウザが開いた |
| アプリ内の窓（CDP の page ターゲット数） | 1 のまま（`window.open` は `null` を返す = deny されている） |
| `file:///etc/passwd` | 開かず、Main に `[external-links] 対応していないスキームなので開きませんでした` の警告。窓も増えない |
| リンクの上のカーソル（周2 の前提） | `getComputedStyle('.xterm-screen').cursor` = `pointer`（リンク以外の行では `text`） |
| **素のクリック（周2 後）** | **サーバへのリクエスト 0 件**（開かない） |
| **Cmd+クリック（周2 後）** | `GET /aiterm-178-cmd-gate` が届く |

### 設計判断

- **`role: 'close'` を足さない**（周3 の見送り）。既定アクセラレータ `Cmd+W` を**ネイティブ登録する**ため、Renderer の `close-pane` と衝突して**押した瞬間にウィンドウごと閉じる**（全タブの PTY が落ちる）。`registerAccelerator: false` を付ければ衝突は消えるが、子ウィンドウでも効かなくなり足す意味が消える。加えて動機は既に無い（設定ウィンドウは `SettingsPanel.tsx` が `Cmd+W` を処理済み、外部窓は周1 で生まれなくなる）
- **`shiftKey` は `LinkClick` 型に入れない**。「Cmd さえ押されていれば shift の有無で結果が変わらない」ことを型で保証し、**判定に使わない値を渡すだけの意味の無いテストを書かない**ため

### 教訓

- **実機（WebGL）と E2E（DOM レンダラ）でリンクの観測点が違う。** 実機には `canvas.xterm-link-layer` があり `.xterm-rows` が無い。E2E は逆。**どちらでも `getComputedStyle('.xterm-screen').cursor` が `pointer` になる**ので、リンクの上に居ることの判定はこれで統一できる
- **`locator(...).filter({ hasText: URL }).last()` は `echo <URL>` をエコーした行を返した。** その行の左端はプロンプトなので `cursor` は `text` のまま。**行の中身がちょうど URL だけであること**を条件に選び直した
- **xterm の DOM レンダラは行の余白を U+00A0 で埋める。** `.trim()` は落とさないので、素朴な文字列一致は1行も当たらない
- **`toContainText(URL)` は `echo <URL>` のエコー行で先に通る。** その直後に `evaluate` すると**出力行がまだ描画されていない**（実測で非空の行が1本だけだった）。`expect.poll` で行の出現を待つ必要がある
- **agent-browser の `type` は効かなかった**（`type <sel> <text>` はセレクタが要る）。素の入力は `keyboard type` を使う。`mouse` サブコマンドは**修飾キーを取れない**ので、Cmd+クリックは `chromium.connectOverCDP` した Playwright から叩いた（スクリプトは scratchpad）
- **xterm のリンクは、画面の内容が変わってもポインタが同じセルに乗ったままだと古い URL を保持する。** `clear` して別の URL を出したのに、前の URL が開いた。一度リンクから離れて戻せば正しくなる（xterm 側の挙動。`known-issues.md` の 2 番）

### 次に再開するとき最初に読むべきこと

- **周1・周2 は完了。周3 は見送り。`overview.md` の完了条件はすべて埋まっている。**
- 残っているのは**ユーザーの明示指示が要る作業だけ**: commit / push / PR 作成、および Issue #178 / #174 へのコメント書き戻し
- 書き戻す内容は `known-issues.md` の 1 番（#174 本文の「設定ウィンドウを `Cmd+W` で閉じられない」は既に解消済み）と、周3 を見送った根拠
- `known-issues.md` に 2 件（xterm のリンクキャッシュ / ホバー下線が Cmd 無しでも出る）が未対処で残っている。**このループの中では起票しない**

---

<!-- 以降、作業のたびにセクションを追記 -->
