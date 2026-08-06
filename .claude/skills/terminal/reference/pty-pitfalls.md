# PTY 起動まわりのハマりどころ

`node-pty` を使った PTY の起動・環境変数・tmux ラップで実際に踏んだ罠と、その対策の理由。実装は [../../../../src/main/pty/manager.ts](../../../../src/main/pty/manager.ts) と [../../../../src/main/pty/tmux.ts](../../../../src/main/pty/tmux.ts)。

## spawn-helper の実行権限が npm install のたびに落ちる

node-pty の macOS 向け prebuild に同梱されている `spawn-helper` は、npm でインストールした際に実行権限（+x）が落ちることがある。この状態で PTY を起動すると、原因の分かりにくい `Error: posix_spawnp failed.` で失敗し、**PTY が一切起動しない**（シェルタブすら開けない）。

対策として [../../../../scripts/fix-node-pty.mjs](../../../../scripts/fix-node-pty.mjs) が `node_modules/node-pty/prebuilds/*/spawn-helper` の権限を復元する。これは `package.json` の `postinstall` で毎回自動実行される。

**⛔ 再インストールのたびに壊れる問題なので、この `postinstall` 連携を外さないこと。** 手動で直す場合のコマンドは README.md の「うまく動かないとき」を参照。

## tmux でラップしたセッションは、タブを閉じても生き残る（2026-08-03 実測、tmux 3.7b）

`useTmux` が有効かつ tmux が使える環境では、`claude` / `gemini` の起動コマンドを `tmux new-session -A -s <name> -- <command> ...` でラップする（[../../../../src/main/pty/tmux.ts](../../../../src/main/pty/tmux.ts)）。この挙動は tmux の実装に依存するため、将来のバージョンでは変わりうる。以下は 2026-08-03 に tmux 3.7b で実測した内容。

**内側のプロセスが正常終了した場合は、tmux なしと同じく `onExit` が発火する。** 内側のコマンドが終わる → tmux のセッションが終了する → クライアントも終了する、という連鎖を辿るため。実測では、内側のコマンドの終了から1秒後には `tmux ls` が `no server running` を返した。実アプリでも、tmux クライアントに SIGTERM を送るとサーバごと終了し、タブは正しく `is-exited` になった。

**罠はタブを閉じる操作（クライアントの kill）の方。** `pty.kill()` が殺せるのは tmux **クライアント**だけで、サーバ側のセッションと内側の `claude` / `gemini` プロセスは生き残る。実機（agent-browser でアプリを操作）でも確認済みで、閉じるボタンでタブを閉じた後も `tmux ls` に該当セッション（`aiterm-<uuid>`）が残り、`ps` に `claude --session-id <uuid> (Ss+)` が生存していた。

**resume できるかは CLI によって非対称。** tmux セッション名は `buildTmuxSessionName(plan.agentSessionId ?? ptyId)` で決まる（[../../../../src/main/pty/tmux.ts](../../../../src/main/pty/tmux.ts) 冒頭のコメント参照）。安定した `agentSessionId` を持つのは claude だけ（`--session-id` / `--resume` に渡した ID がそのまま入る）なので、claude はタブを閉じても履歴から resume すれば同じ tmux セッションに `-A` でアタッチし直せる**はず**（**未実測**。`test/unit/pty-plan.test.ts` が固定しているのは「新規起動と resume でセッション名が一致する」までで、**実際に閉じる前の画面が戻るかは一度も確かめていない**。手順は [/e2e](../../e2e/reference/limitations.md) の「実機確認の手順書」の #154）。gemini はタブを閉じた時点で名前を二度と再現できず、生き残ったプロセスは孤立したまま残り続ける。

⚠ **gemini 側の理由を「安定したセッション ID を採番できないから」と書かないこと**（Issue #155 / 2026-08-06 に Gemini CLI 0.53.0 で実測して覆した）。`gemini --session-id <UUID>` は存在し、渡した UUID はそのまま `--list-sessions` 行末の `[UUID]` に出る。会話が1往復以上あるセッションは**走行中でも**一覧に正しく出るので、claude と同じ形にできる見込みがある。**いま拾い直せないのは未実装だから**であって、CLI 側の制約ではない。

⛔ ただし実装するとき `--resume` に UUID を渡さないこと（**数字始まりの UUID は index として解釈され、既存のセッションファイルを失う**）。resume の引数は index のままにし、UUID は tmux セッション名にだけ使う。

⚠ 別件で、**実質空のセッション（初期コンテキストだけで会話が0往復）は、gemini をもう1つ起動しただけで削除される**（`--list-sessions` に限らず起動全般）。再現手順は `.claude/workspace/issue-180/known-issues.md` の 12番。

## ⛔ tmux は env を引き継がない（2026-08-06 実測、tmux 3.7b）

**tmux ラップされるペイン（= claude / gemini 全部）には、`buildPtyEnv()` が組み立てた値が1つも届かない。**

tmux はサーバ・クライアント型で、セッションの中で走るプロセスが継ぐのは**サーバ起動時に凍結された env**。クライアント側から引き継がれるのは `update-environment`（既定で DISPLAY / SSH_* など13個）に挙がっているものだけ。**`GOOGLE_CLOUD_PROJECT` のような任意の変数は落ちる。**

しかも tmux サーバは**アプリより長生きする**（実測: アプリが2日前に立てたサーバがそのまま使われていた）ので、「アプリを起動し直せば直る」でもない。

実害: `~/.zshrc` の `GOOGLE_CLOUD_PROJECT` が届かず、Gemini タブが `IneligibleTierError: This client is no longer supported for Gemini Code Assist for individuals` で**認証できなかった**。

**切り分け方が要点。** 設定「アプリを閉じても AI の作業を続ける」を切る（= tmux ラップをやめる）と、**同じアプリ・同じ env で認証が通る**。tmux ラップの有無で挙動が変わったら、まず env の到達を疑う。

### ⛔ 直し方: 値を argv に載せてはいけない（`ps` から読める）

対処は **`update-environment` に変数名を足すこと**（`ensureTmuxUpdateEnvironment`）。tmux はそこに挙がっている名前だけを**クライアントの env から**読むので、**値は一度も argv を通らない**。

⛔ **`-- /usr/bin/env K=V ... <command>` でラップしてはいけない。** 一度これを入れて同じ周の中で気づいた（2026-08-06）。`env` は exec するので env 自身の argv は消えるが、**node-pty が起動した tmux クライアントはタブが開いている間ずっと生き、その argv に全ての値が残る**:

```
$ ps -eo command | grep new-session
tmux new-session -A -s aiterm-… -- /usr/bin/env SECRET_TOKEN=hunter3xyz … gemini …
```

**同じマシンの誰からでも読める。** 利用者の rc に書かれた API キー等がそのまま載る。

⛔ **`tmux new-session -e K=V` も同じ理由で使えない**（値が argv に載る。加えて tmux 3.2 以降にしか無く、`-A` で既存セッションに当たると無視されることも実測済み）。

⚠ **測り方の注意**: `-d`（デタッチ）で作ったセッションでは**漏れない**（クライアントが残らないため）。**アプリと同じく pty でアタッチしたクライアントを残して測ること**。これを間違えると「漏れていない」と誤判定する。

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

⚠ **AI ペイン（claude / gemini）はログインシェルを挟まず素で spawn される**ので、この恩恵を受けない。GUI 起動の .app は `~/.zshrc` の値を1つも持たないため、**シェルタブでは動くのに AI タブでだけ動かない**という非対称が起きる。埋め合わせは [../../../../src/main/shell-path.ts](../../../../src/main/shell-path.ts) が起動時に1回だけ行う（PATH と env をまとめて取る）。

⛔ **env が要るからといって、ここと別にログインシェルを起動しないこと。** ユーザーの rc が2回走り、起動も2倍待たされる（#180 周11 で一度そうしてしまい、統合して1回に戻した）。

⚠ **`-l` だけでは `~/.zshrc` を読まない。** zsh は対話シェルのときしか `.zshrc` を読まないので `-i` が要る。⛔ **親の env を持ったまま測ると必ず「取れた」と出る**ので、`env -i` で親を切ってから測ること（この誤りで一度、逆の結論を出しかけた）。

## PTY の出力は加工しない

ANSI エスケープを自前で解釈・整形せず、バイト列のまま Renderer に流す設計。これは PTY 起動固有の話ではなくアプリ全体の鉄則なので、根拠と詳細はルート [CLAUDE.md](../../../../CLAUDE.md) の「アーキテクチャの鉄則」を参照する（ここでの二重記載はしない）。
