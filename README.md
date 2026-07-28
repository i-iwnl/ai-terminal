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

### デバッグ

開発起動（`make dev`）では **DevTools が別ウィンドウで自動的に開く**。手動で開閉する場合は `Cmd+Option+I`。

```bash
make dev-quiet   # DevTools を開かずに起動する
make dev-debug   # Main プロセスのデバッガを有効にして起動する
```

`make dev-debug` は `--inspect --sourcemap` 付きで起動するので、Chrome の `chrome://inspect` か VS Code の Attach 構成から Main プロセスに接続できる。PTY の起動引数や `claude agents --json` のパース結果を追いたいときはこちら。

**Main プロセスの `console.log` は DevTools ではなくターミナル側に出る**（`make dev` を実行している端末）。

---

## 使い方ガイド

以下の画像は E2E テスト（Playwright）の隔離ハーネス上で撮影したもの。**一時 HOME と偽の `claude` / `gemini` CLI を使っており、プロジェクト名・セッション内容・ユーザー名はすべてダミー**。実在のプロジェクトやセッションではない。

### 1. 起動するとどう見えるか

![起動直後の画面](docs/images/S01-launch.png)

左に「実行中タスク / 履歴 / メモ」を切り替えるサイドバー、上にシェルや AI エージェントのタブを並べるタブバー、その下にターミナル本体が並ぶ。ターミナル部分はいつもの `zsh` / `bash` のプロンプトがそのまま表示される。

### 2. 普通のターミナルとして使う

![コマンド入力と出力](docs/images/S03-shell-echo.png)

コマンドを打てば結果がそのまま返る。PTY の出力はアプリ側で加工していないので、CLI 側の色付けやプログレス表示もそのまま流れてくる。

![日本語と絵文字の文字幅](docs/images/S04-wide-chars.png)

日本語や絵文字も文字幅がずれずに描画される（全角は半角のちょうど2倍幅）。`vim` や `htop` のような画面を書き換えるタイプの CLI もそのまま動く。

### 3. タブを増やす

![タブを増やす](docs/images/S06-new-tab.png)

`Cmd+T` か「+」ボタンで新しいシェルタブが開く。タブごとに独立したシェルで、`Cmd+W` で閉じられる（最後の1枚を閉じると新しいシェルが自動的に開く）。

### 4. AI エージェントを起動する

![claude を起動する](docs/images/S09-launch-claude.png)

`Cmd+K` で現在の作業ディレクトリを引き継いだまま `claude` が新しいタブとして起動する（`Cmd+Shift+K` なら `gemini`）。起動時にアプリ側が採番した UUID を `--session-id` として渡しており、これが後述のタスク一覧・履歴との突き合わせキーになる。

### 5. 実行中タスクを一覧で見る

![実行中タスク一覧](docs/images/S12-task-list.png)

サイドバーの「タスク」タブには、いま動いている `claude` セッションが `claude agents --json` のポーリングで一覧表示される。応答待ち（busy）は目立つオレンジ、待機中（idle）は緑の点で区別される。他のプロジェクトで動かしているセッションも（同一マシン上なら）一緒に見える。

### 6. 過去のセッションを再開する

![履歴の並び順](docs/images/S16-history-order.png)

サイドバーの「履歴」タブには `~/.claude/projects` 以下のセッション履歴が更新時刻の降順で並ぶ。タイトルは AI が生成したもの（`ai-title`）を使い、無ければ最初のプロンプトの冒頭を代わりに表示する。

![壊れた履歴の縮退表示](docs/images/S18-history-broken.png)

セッションの JSONL は Claude Code 公式が「内部フォーマットでバージョン間に変わりうる」と明記しているため、パースに失敗したセッションも一覧から消さず、sessionId と更新時刻だけで縮退表示する（CLAUDE.md の設計方針そのもの）。

![履歴から resume する](docs/images/S19-history-resume.png)

履歴をクリックすると新しいタブが開き、`claude --resume <sessionId>` で続きから再開できる。

### 7. メモを残す

サイドバーの「メモ」タブに、どこにも属さない**全体メモ**と、履歴セッションに紐付く**セッションメモ**を書ける。

- **全体メモ**: 常に1枚だけの走り書き。「あとで直す」「このブランチの前提」など、行き場のないメモの置き場
- **セッションメモ**: 履歴一覧の行にカーソルを合わせると出る「メモ」ボタンから開く。そのセッションの調査経過や、次に何を頼むかを残せる

保存ボタンは無い。入力が止まると自動で保存され、入力欄から離れたときにも保存される。**本文を空にするとそのメモは削除される**（空のメモが一覧に残り続けない）。

保存先は `~/.ai-terminal/memos.json`。`claude` / `gemini` 側のファイルには一切書き込まない。

### 8. 日本語を入力する

![IME の変換中表示](docs/images/S22-ime-composition.png)

日本語 IME の変換中（未確定）の文字列もその場に表示され、確定すると通常どおりシェルに渡る。

### 9. 通知とサウンドを設定する

![設定パネル](docs/images/S31-settings-panel.png)

タブバー右端の「設定」ボタン（または `Cmd+,`）で設定パネルが開く。`config.json` を手で編集しなくても、次を変更できる。

- **フォントと文字サイズ** — 変更するとその場でターミナルに反映される
- **通知音** — macOS のシステムサウンド（`/System/Library/Sounds`）と `~/Library/Sounds` に置いた音源から選べる。「試聴」でその場で鳴らせる
- **Slack / Discord への転送** — Incoming Webhook の URL を入れると、タスク完了通知が Slack / Discord にも届く。「テスト送信」で保存前に到達を確認できる

`Escape`・背景クリック・「x」のいずれでも閉じる。変更は即座に `~/.ai-terminal/config.json` に保存される。

> **Webhook URL は `config.json` に平文で保存される。** リポジトリに含まれる場所ではないが、設定ファイルを共有・バックアップするときは注意すること。

### 10. うまくいかないとき

![CLI が見つからないとき](docs/images/S11-cli-missing.png)

`claude` / `gemini` が PATH に無いときは、サイドバーのタスク一覧に日本語のエラーが表示される。この状態でもアプリ本体は落ちず、既存のシェルタブは普通に使い続けられる（縮退動作の一例）。他のトラブルシューティングは [うまく動かないとき](#うまく動かないとき) を参照。

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
| `Cmd+,` | 設定パネルの開閉 |

`Ctrl+C` などターミナル本来のキー入力は一切妨げない（`Cmd` 系のみを横取りしている）。

---

## 設定

**通知・サウンド・フォントはアプリ内の設定パネル（`Cmd+,`）から変更できる。** ここに書くのは、パネルに出していない項目も含めたファイルの全体像。

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
  "notifySoundId": "Glass",         // 空文字なら OS 既定音。絶対パスで自前の音源も指定できる
  "slack": {
    "enabled": false,
    "url": ""                       // Slack Incoming Webhook の URL
  },
  "discord": {
    "enabled": false,
    "url": ""                       // Discord Webhook の URL
  },
  "scopeAgentsToCwd": false,        // true にすると現在のディレクトリのタスクだけ表示
  "theme": {
    "background": "#1e1e1e",
    "foreground": "#d4d4d4",
    "cursor": "#d4d4d4",
    "selectionBackground": "#264f78"
  }
}
```

`notifySoundId` は `/System/Library/Sounds` と `~/Library/Sounds` から音源名で探す（`Glass` なら `Glass.aiff`）。`/` で始まる値は絶対パスとしてそのまま使う。**指定した音源が見つからない場合は無音になるだけで、通知そのものは出る。**

---

## 検証

```bash
make check           # typecheck + lint + 単体テスト（ホストで実行）
make unit            # 単体テストのみ（vitest）
make e2e             # E2E（Playwright で Electron を起動）
make e2e-headless    # E2E をウィンドウを表示せずに実行
make docker-verify   # typecheck + lint + build を Docker コンテナ内で実行
```

テストは2層に分かれている。

| 層 | 置き場 | 対象 |
|---|---|---|
| 単体（vitest） | `test/unit/` | 外部に触れない純粋関数（設定の正規化・メモの更新・Webhook のペイロード・PTY の起動引数・表示整形・ショートカット判定） |
| E2E（Playwright） | `e2e/specs/` | 実際に Electron を起動して確かめる振る舞い（全32シナリオ） |

`make e2e-headless` は**ウィンドウを画面に出さずに**全シナリオを走らせる。作業を続けながら回せる。Electron に真のヘッドレスモードは無いため、やっているのは起動直後に `BrowserWindow.hide()` を呼ぶことだが、実測では描画（WebGL のピクセル）・マウス選択・IME まで表示時と同じ結果になる。**ただし macOS の GUI セッションは必要**（ヘッドレスな Linux CI で回すには別途 `xvfb` が要る）。

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
    history/     ~/.claude/projects の JSONL 読み取り、タイトル上書き
    memo/        ~/.ai-terminal/memos.json（全体メモ / セッションメモ）
    notify/      macOS 通知・通知音（afplay）・Slack / Discord への転送
    config.ts    ~/.ai-terminal/config.json
  preload/       contextBridge で window.api を露出
  renderer/      React の UI
    terminal/    xterm.js
    sidebar/     タスク / 履歴 / メモ
    tabs/        タブバーとタブ状態
    settings/    設定パネル（モーダル）
  shared/ipc.ts  IPC 契約。チャンネル名と型の単一の正

test/unit/       単体テスト（vitest）
e2e/             E2E（Playwright + Electron）
```

**Renderer は OS を直接触らない。** PTY 起動もファイル読み込みも Main プロセス側で行い、`contextIsolation` を維持している。

---

## うまく動かないとき

**`npm run dev` が `Error: Electron uninstall` で落ちる**

`npm install` で Electron 本体のバイナリがダウンロードされないことがある。

```bash
make fix-electron
```

**ターミナルが開かず `posix_spawnp failed` と出る**

node-pty に同梱されている `spawn-helper` の実行権限が、npm install のときに落ちることがある。`postinstall` で自動的に復元しているが、手動で直す場合は次を実行する。

```bash
node scripts/fix-node-pty.mjs
```

**`Unable to load preload script` と出る**

`package.json` が `"type": "module"` のため、electron-vite は preload を `.mjs` として出力する。`src/main/index.ts` の preload パスが `.js` になっていないか確認する。**このエラーは DevTools を開いていないと気づけない**（ターミナル側には出ない）ので、挙動がおかしいときはまず DevTools を開くこと。

**`claude コマンドが見つかりません` と表示される**

`claude` が PATH にあるか確認する。アプリはログインシェル（`$SHELL -l`）で PTY を起動するので、`.zprofile` などで PATH を通していれば拾える。

**タスク一覧が空のまま**

`claude agents --json` が動くか手元で確認する。この出力形式は CLI のバージョンで変わりうるため、変わった場合は `src/main/agents/claude.ts` の1ファイルだけを直せばよい設計になっている。

**履歴一覧のタイトルが出ない項目がある**

`ai-title` が生成される前のセッションではタイトルが取れない（実データで約 14%）。その場合は最初のプロンプトの冒頭が代わりに表示される。仕様上の縮退であって不具合ではない。

**Slack / Discord に通知が届かない**

設定パネルの「テスト送信」を押すと結果がその場に出る。よくある原因:

- URL 欄の左のチェックボックスが入っていない（URL を入れただけでは送らない）
- Webhook URL が失効している（`HTTP 404: no_service` などが表示される）
- 社内ネットワークのプロキシで外向き HTTPS が塞がれている

**通知音が鳴らない**

「通知音を鳴らす」が有効か、選んだ音源が存在するかを確認する。**存在しない音源を指定した場合は無音になるだけで、通知そのものは出る**（設定に古い音源名が残っていてもエラーにはしない）。macOS 以外では音の再生自体を行わない。

**tmux 有効時、`claude` を終了してもタブが閉じない**

`tmux new-session -A` でラップしているため、内側の `claude` が終わっても tmux セッション自体は生き残る。これは「アプリを落としても作業が続く」という永続化の目的そのものによる挙動。タブを明示的に閉じるか、`useTmux` を false にする。
