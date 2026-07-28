# 隔離ハーネス（e2e/fixtures/harness.ts）

`e2e/fixtures/harness.ts` の `launchApp()` / `closeApp()` が、この E2E 基盤の中核。すべての spec がこれ経由でアプリを起動する。

## なぜ隔離が必要か

このアプリは実 OS に直接触る（PTY で本物のシェルを起動し、`claude agents --json` でマシン上の実セッションを拾い、`~/.claude/projects` の実履歴を読む）。素直にテストを書くと次の2つの問題が起きる。

- 結果が非決定的になる（テスト実行時にたまたま動いている実タスクの有無で結果が変わる）
- **スクリーンショットに実プロジェクト名や実プロンプトが写り込む**（開発機の実データがそのまま画像として残ってしまう）

## どう隔離しているか

`launchApp()` は Electron を起動する前に、一時ディレクトリの下に以下を用意し、環境変数で差し替える。**アプリ本体のコードは一切変更していない。**

- 一時 `HOME`（`mkdtempSync` で作成。テストごとに独立）
- `PATH` の先頭に偽 CLI（`e2e/fixtures/bin/claude` / `gemini`）を置いたディレクトリ
- 固定内容の `~/.ai-terminal/config.json`（フォント・テーマ・ポーリング間隔を固定してスクリーンショットを再現可能にする）
- `~/.claude/projects/<encoded-cwd>/*.jsonl` の履歴フィクスチャ（`withoutHistory` 未指定時）

## 偽 CLI の設計

`e2e/fixtures/bin/claude` と `gemini` は、`agents --json` / `--list-sessions` / `--version` には固定のフィクスチャ（`AI_TERMINAL_E2E_FIXTURES` 配下）を返し、それ以外（対話起動）では**受け取った引数をそのまま `ARGS: ...` として標準出力に書いてから入力を待つ**。これにより、`--session-id` に UUID が渡っているか、`--resume <sessionId>` が正しいセッション ID を指しているかを、内部実装を覗かずにターミナルの表示だけから検証できる（例: [../../../../e2e/specs/S09-launch-claude.spec.ts](../../../../e2e/specs/S09-launch-claude.spec.ts)）。

## `launchApp(options)` のオプション

| オプション | 効果 |
|---|---|
| `agentsFail` | `claude agents --json` が失敗する状況を再現する（偽 CLI が非ゼロ終了） |
| `agentsEmpty` | `claude agents --json` が0件（`[]`）を返す状況を再現する |
| `geminiEmpty` | `gemini --list-sessions` が0件を返す状況を再現する |
| `withoutCli` | 偽 CLI を `PATH` に置かない（CLI 不在時のエラー表示を検証する） |
| `withoutHistory` | 履歴の JSONL フィクスチャを配置しない（履歴が空の状態を検証する） |
| `config` | `config.json` の値を上書きする（既定値は `harness.ts` の `DEFAULT_CONFIG`） |
| `gpu` | GPU を有効にして起動する（= xterm が WebGL レンダラになる）。既定は無効 |

### `gpu` を使うときの注意

既定では全シナリオを `--disable-gpu` で起動する。WebGL レンダラだと文字が canvas に描かれ DOM から読めないため、テキストで検証できなくなるからだ。

**この既定は検証の盲点を作る。** DOM レンダラは文字を実 DOM のテキストノードとして描くので、`xterm.css` の読み込みを忘れていても表示されてしまう。実際にその不具合を全22シナリオ green のまま見逃し、`make dev` でターミナルが真っ黒になっていた。

`gpu: true` にした場合、検証手段はピクセルしかない。[../../../../e2e/fixtures/pixels.ts](../../../../e2e/fixtures/pixels.ts) の `captureRegionStats()` を使う（Electron の `capturePage()` から生のビットマップを取るので画像ライブラリは不要）。実例は [../../../../e2e/specs/S23-webgl-rendering.spec.ts](../../../../e2e/specs/S23-webgl-rendering.spec.ts)。

判定はピクセル数の**絶対値ではなく増分**で書くこと。フォント・解像度・テーマに依存しなくなる。なお描画が完全に壊れていてもカーソルのブロックだけは描かれるため、「単色でないこと」だけの判定では不具合を捕まえられない。

## ハマりどころ（実際に踏んだもの）

- **`--disable-gpu` で起動している理由**: 付けないと xterm.js が WebGL レンダラを使い、文字が canvas に描かれて DOM から読めなくなる。`--disable-gpu` で WebGL アドオンの初期化を失敗させると、アプリ側の try/catch が DOM レンダラへフォールバックし、`.xterm-rows` からテキストを検証できるようになる
- **macOS の一時ディレクトリは `/var` 配下だが、`/var` は `/private/var` へのシンボリックリンク**。OS の `getcwd()` は正規化した `/private/var/...` を返すため、`mkdtempSync` の戻り値に `realpathSync` を取らずにフィクスチャを置くと、アプリが探すパスと1文字ずれて履歴が見つからなくなる（`~/.claude/projects` のディレクトリ名は cwd の絶対パスから機械的に作られるため）
- **Electron の `userData` は `HOME` の差し替えを無視**して `~/Library/Application Support/ai-terminal` を共有する。`--user-data-dir` を分けないと、並列に回した別テストのウィンドウ状態やキャッシュが混ざる
- **実データのスキーマを推測で書かない**: 履歴 JSONL の `ai-title` 行のキーは `title` ではなく `aiTitle`。実際にこれを取り違えてフィクスチャを間違えた前例がある。フィクスチャを書く前に、実際の `~/.claude/projects/*.jsonl` を走査してキー名を確認すること
- xterm.js の DOM レンダラは `.xterm-screen` の子要素に `<style>`（カーソル点滅の keyframes 等）を差し込む。そのため `.xterm-screen` の `textContent` で検証すると CSS のテキストまで拾って判定が不安定になる。実際に描画された行だけを持つ `.xterm-rows` を対象にする
- 変換中（未確定）の IME テキストが出るのは `.composition-view`。他の xterm.js 由来の要素と違い、クラス名に `xterm-` の接頭辞が付かない
