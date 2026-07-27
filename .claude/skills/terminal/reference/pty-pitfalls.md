# PTY 起動まわりのハマりどころ

`node-pty` を使った PTY の起動・環境変数・tmux ラップで実際に踏んだ罠と、その対策の理由。実装は [../../../../src/main/pty/manager.ts](../../../../src/main/pty/manager.ts) と [../../../../src/main/pty/tmux.ts](../../../../src/main/pty/tmux.ts)。

## spawn-helper の実行権限が npm install のたびに落ちる

node-pty の macOS 向け prebuild に同梱されている `spawn-helper` は、npm でインストールした際に実行権限（+x）が落ちることがある。この状態で PTY を起動すると、原因の分かりにくい `Error: posix_spawnp failed.` で失敗し、**PTY が一切起動しない**（シェルタブすら開けない）。

対策として [../../../../scripts/fix-node-pty.mjs](../../../../scripts/fix-node-pty.mjs) が `node_modules/node-pty/prebuilds/*/spawn-helper` の権限を復元する。これは `package.json` の `postinstall` で毎回自動実行される。

**⛔ 再インストールのたびに壊れる問題なので、この `postinstall` 連携を外さないこと。** 手動で直す場合のコマンドは README.md の「うまく動かないとき」を参照。

## tmux でラップすると PTY の exit が発火しないことがある

`useTmux` が有効かつ tmux が使える環境では、`claude` / `gemini` の起動コマンドを `tmux new-session -A -s <name> -- <command> ...` でラップする（[../../../../src/main/pty/tmux.ts](../../../../src/main/pty/tmux.ts)）。

この場合、**内側の `claude` プロセスが終了しても node-pty の `onExit` は発火しない**。`tmux new-session -A` が起動しているのは tmux セッションそのものであり、tmux セッション自体が消えたとき（`tmux kill-session` 等）にのみ exit が発火するため。

これは「アプリを落としても AI の作業が生き残る」という永続化の目的そのものによる挙動であり、バグではない。**タブを閉じるべきかどうかの判定を PTY の exit イベントだけに頼らないこと。** 内側のコマンドが終わったかどうかを知りたい場合は、`claude agents --json` のポーリング結果（/ai-cli 側の責務）と突き合わせる。

## PTY に渡す環境変数

`buildPtyEnv()`（manager.ts）が組み立てる規約:

| 項目 | 内容 | 理由 |
|---|---|---|
| `ELECTRON_*` | すべて削除する | Electron が注入するこれらの変数が子プロセス（シェルや CLI）の挙動を壊しうるため。残したまま `claude` 等を起動すると想定外の分岐に入ることがある |
| `TERM` | `xterm-256color` を設定 | 未設定・不適切だと `ls --color` 等の色指定が正しく出ない |
| `COLORTERM` | `truecolor` を設定 | 同上。24bit カラーを使う TUI アプリの表示に影響する |
| `LANG` | 未設定なら `ja_JP.UTF-8` を補う | 未設定のままだと日本語の表示・入力まわりで文字化けや幅計算の誤りが起きうる |

## シェルの決定順とログインシェル起動

`buildShellPlan()`（manager.ts）の決定順は **設定ファイルの `shell` -> `$SHELL` -> `/bin/zsh`**。起動時は `-l`（ログインシェル）を付与する。

ログインシェルとして起動するのは、`.zprofile` 等で通した PATH を拾わせるため。ここが崩れて非ログインシェルで起動すると、ターミナル上で `claude` / `gemini` が「コマンドが見つかりません」になる（PATH 未継承が原因のケースは README.md の「うまく動かないとき」にも実例がある）。

## PTY の出力は加工しない

ANSI エスケープを自前で解釈・整形せず、バイト列のまま Renderer に流す設計。これは PTY 起動固有の話ではなくアプリ全体の鉄則なので、根拠と詳細はルート [CLAUDE.md](../../../../CLAUDE.md) の「アーキテクチャの鉄則」を参照する（ここでの二重記載はしない）。
