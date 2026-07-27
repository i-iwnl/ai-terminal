# ai-terminal

AI コーディングエージェント（Claude Code / Gemini CLI）を飼うことに最適化した、macOS 向けの自作ターミナルアプリ。

普段使いのターミナルとして動きつつ、左サイドバーで「いま AI が何をしているか」が常に見えて、過去のセッションをワンクリックで再開できる。

- 設計の全体像 -> [docs/PLAN.md](docs/PLAN.md)
- Docker 環境の使い方 -> [docs/DOCKER.md](docs/DOCKER.md)
- AI エージェントの隔離実行 -> [docs/SANDBOX.md](docs/SANDBOX.md)
- 実装ルール -> [CLAUDE.md](CLAUDE.md)

---

## 必要なもの

| | 用途 | 必須 |
|---|---|---|
| Node.js 22 系 | ビルドと実行 | 必須 |
| macOS | 動作対象 | 必須 |
| `claude` コマンド | Claude Code 連携 | 連携機能を使う場合 |
| `gemini` コマンド | Gemini CLI 連携 | 連携機能を使う場合 |
| `tmux` | セッション永続化（アプリを落としても AI の作業が生き残る） | 任意 |
| Docker | 検証コンテナ / サンドボックス | 任意 |

`claude` / `gemini` は **API キーではなく CLI のサブスクリプション認証をそのまま使う**設計なので、事前に各 CLI でログインを済ませておくこと。

---

## 起動方法

```bash
make install   # 依存のインストール（初回のみ）
make dev       # アプリを起動
```

`make` を使わない場合:

```bash
npm install
npm run dev
```

**アプリ本体は必ずホスト（macOS）で起動する。** GUI を Docker で動かす構成は用意していない（日本語 IME とフォントが壊れるため、設計段階で意図的に除外している）。詳細は [docs/DOCKER.md](docs/DOCKER.md)。

### 本番ビルド

```bash
make build     # out/ に main / preload / renderer を出力
```

開発時は Vite の dev server（`localhost:5173`）経由で Renderer を読み込むが、**ビルド後はポートを一切使わない**（ローカルファイルを直接読む）。

---

## キーボードショートカット

| キー | 動作 |
|---|---|
| `Cmd+T` | 新しいシェルタブ |
| `Cmd+W` | 現在のタブを閉じる（最後の1枚を閉じると新しいシェルが開く） |
| `Cmd+1` 〜 `Cmd+9` | タブ切り替え |
| `Cmd+K` | 現在の作業ディレクトリで **claude** を新しいタブで起動 |
| `Cmd+Shift+K` | 同様に **gemini** を起動 |
| `Cmd+F` | ターミナル内検索 |

`Ctrl+C` などターミナル本来のキー入力は一切妨げない（`Cmd` 系のみを横取りしている）。

---

## 設定

`~/.ai-terminal/config.json` を置くと反映される。ファイルが無ければ既定値で動く。**壊れた JSON を置いてもアプリは落ちず、既定値に縮退する。**

```jsonc
{
  "shell": "/bin/zsh",              // 省略時は $SHELL
  "fontFamily": "Menlo, monospace",
  "fontSize": 13,
  "pollIntervalMs": 3000,           // タスク一覧の更新間隔
  "useTmux": true,                  // tmux があれば AI CLI をラップする
  "notifyOnIdle": true,             // 作業完了時に macOS 通知
  "notifySound": true,
  "scopeAgentsToCwd": false,        // true にすると現在のディレクトリのタスクだけ表示
  "theme": {
    "background": "#1e1e1e",
    "foreground": "#d4d4d4",
    "cursor": "#d4d4d4",
    "selectionBackground": "#264f78"
  }
}
```

---

## 検証

```bash
make check           # typecheck + lint（ホストで実行）
make docker-verify   # typecheck + lint + build を Docker コンテナ内で実行
```

`make docker-verify` はマシン依存を排除した再現確認用。`node_modules` は named volume でホストと隔離してあるので、macOS 側のネイティブモジュールを壊すことはない。

---

## AI エージェントのサンドボックス

`claude` に危険なコマンドを試させたいときは、対象ディレクトリだけをマウントしたコンテナの中で動かせる。

```bash
make sandbox                     # カレントディレクトリをマウントして起動
./scripts/sandbox.sh ~/some/dir  # 特定のディレクトリを指定
```

**初回はコンテナ内で `claude` のログインが必要**（macOS の認証情報は Keychain にあり、コンテナへ引き継げないため）。ログイン結果は専用の named volume に永続化される。

隔離には限界がある。**マウントしたディレクトリ自体は保護されない。** 使う前に [docs/SANDBOX.md](docs/SANDBOX.md) の「隔離の限界」を読むこと。

---

## ディレクトリ構成

```
src/
  main/          Main プロセス（Node.js）
    pty/         PTY のライフサイクル管理、tmux ラップ
    agents/      claude agents --json のポーリング
    history/     ~/.claude/projects の JSONL 読み取り
    config.ts    ~/.ai-terminal/config.json
    notify.ts    macOS 通知
  preload/       contextBridge で window.api を露出
  renderer/      React の UI（xterm.js / サイドバー / タブ）
  shared/ipc.ts  IPC 契約。チャンネル名と型の単一の正
```

**Renderer は OS を直接触らない。** PTY 起動もファイル読み込みも Main プロセス側で行い、`contextIsolation` を維持している。

---

## うまく動かないとき

**`npm run dev` が `Error: Electron uninstall` で落ちる**

`npm install` で Electron 本体のバイナリがダウンロードされないことがある。

```bash
make fix-electron
```

**`claude コマンドが見つかりません` と表示される**

`claude` が PATH にあるか確認する。アプリはログインシェル（`$SHELL -l`）で PTY を起動するので、`.zprofile` などで PATH を通していれば拾える。

**タスク一覧が空のまま**

`claude agents --json` が動くか手元で確認する。この出力形式は CLI のバージョンで変わりうるため、変わった場合は `src/main/agents/claude.ts` の1ファイルだけを直せばよい設計になっている。

**履歴一覧のタイトルが出ない項目がある**

`ai-title` が生成される前のセッションではタイトルが取れない（実データで約 14%）。その場合は最初のプロンプトの冒頭が代わりに表示される。仕様上の縮退であって不具合ではない。

**tmux 有効時、`claude` を終了してもタブが閉じない**

`tmux new-session -A` でラップしているため、内側の `claude` が終わっても tmux セッション自体は生き残る。これは「アプリを落としても作業が続く」という永続化の目的そのものによる挙動。タブを明示的に閉じるか、`useTmux` を false にする。
