# Architecture

Issue #40 における変更対象の構造。
設計判断の根拠は末尾の「設計判断履歴」を参照。

---

## 1. 対象トラック

単一トラック（main のみ。Renderer は触らない）

| コンポーネント | 変更内容 | 影響範囲 |
|---|---|---|
| src/main/shell-path.ts（新設） | ログインシェルから PATH を取得し process.env.PATH にマージ | PTY 起動（pty/manager.ts）・agents ポーリング（agents/claude.ts）・gemini 履歴（history/reader.ts）・tmux 判定（pty/tmux.ts）が間接的に恩恵を受ける |
| src/main/index.ts | 起動シーケンスの先頭で shell-path の解決を await | 起動時のみ |

---

## 2. Contract（src/shared/ipc.ts）変更

なし

---

## 3. 技術的制約・前提条件

- 取得失敗（シェルが応答しない・非ゼロ終了等）でアプリを落とさない。タイムアウト付きで実行し、失敗時は既存 PATH のまま縮退する（CLAUDE.md 鉄則5 の精神）。
- 既存の spawn / execFile 呼び出し側（4箇所）は一切変更しない。全箇所が `process.env` を参照しているため、起動時の1箇所で完結させる。
- ログインシェルの決定順は PTY と同じ `process.env.SHELL || '/bin/zsh'`（config.shell は PTY 用の設定なので起動時解決には使わない。config 読み込み前に PATH を直したい）。

---

## 4. 設計判断履歴

| 日付 | 判断 | 根拠 | 代替案 |
|---|---|---|---|
| 2026-07-29 | 起動時に process.env.PATH を1回だけ書き換える方式 | 全 spawn / execFile が process.env 依存で、修正が1箇所で済む。呼び出し側の変更ゼロ | 各 spawn 箇所で都度 PATH を解決（箇所が増えるたびに漏れるので却下）、fix-path 等の外部パッケージ導入（依存を増やすほどの処理ではないので却下） |
| 2026-07-29 | `$SHELL -i -l -c 'printf %s "..."'` で取得し、目印（DELIMITER）で挟んで切り出す | -l だけでは zsh が .zshrc を読まず、nvm 等（.zshrc に書かれがち）の PATH が取れない。rc の echo ノイズは目印の間だけを見ることで無害化 | launchctl getenv PATH（ユーザーのシェル設定を反映しないので却下） |
| 2026-07-29 | マージは既存 PATH を先頭に保ち、ログインシェル由来の不足分を後ろに追記 | 既に解決できているコマンドの解決先を変えない。E2E ハーネスは PATH 先頭に偽 CLI を置いて隔離しており、ログインシェル側を先頭にするとこの隔離が崩れうる | ログインシェル PATH を先頭に（fix-path 流の全置換も含め、E2E 隔離と dev の PATH 調整を壊すリスクがあり却下） |
