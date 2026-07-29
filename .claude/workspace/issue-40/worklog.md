# Worklog

時系列の作業ログ。**設計判断の根拠**と**学んだ教訓**を中心に記録する。
コード差分は git log を参照、現状の構造は `architecture.md` を参照。

---

## 2026-07-29 - 原因特定・Issue 起票・ワークスペース作成

### 実施内容

- ユーザー報告「安定版を起動すると claude コマンドが見つかりませんと出る」の原因を特定
  - Finder 起動の .app は launchd の最小 PATH（/usr/bin:/bin:/usr/sbin:/sbin）しか継承しない
  - `claude` は `~/.local/bin`、`gemini` は nvm の bin にあり、最小 PATH に含まれない
  - `make dev` はターミナル起動なのでシェル PATH を継承し、再現しない
- 影響箇所は4つで全て同根（process.env の PATH 依存）: pty/manager.ts の buildPtyEnv、agents/claude.ts の execFile、history/reader.ts の execFile、pty/tmux.ts の存在判定
- Issue #40 を起票し、ワークスペースを作成

### 設計判断

- 起動時に1回だけ process.env.PATH をログインシェル由来の PATH でマージする方式に決定（詳細と代替案は architecture.md）

### 次に再開するとき最初に読むべきこと

- 実装はまだ。次は `src/main/shell-path.ts` の新設と `src/main/index.ts` への組み込みから
- 検証は test/unit/ に純粋関数（PATH マージ）のテストを足し、make check → make e2e の順

---

## 2026-07-29 - 実装・検証・文書更新（同日2周目）

### 実施内容

- `src/main/shell-path.ts` を新設。純粋関数 `extractDelimitedPath`（目印で挟んだ PATH の切り出し）と `mergePathEntries`（既存 PATH 優先の重複排除マージ）、副作用側 `ensureLoginShellPath`（`$SHELL -i -l -c` をタイムアウト3秒で実行、失敗時は何もしない縮退）に分離
- `src/main/index.ts`: モジュール読み込み時に解決を開始し（Electron 初期化と並行）、`whenReady` 内でハンドラ登録前に await
- `test/unit/shell-path.test.ts` に純粋関数のテスト8件を追加
- `make check` green（93件）。`make e2e` は 37 passed + S11 が1回 flaky → S11 単独5連続 green で、既知 Issue #17（起動時 flake）と同型と判断
- launchd 相当の最小 PATH（`env -i PATH=/usr/bin:...`）から `/bin/zsh -i -l` で `~/.local/bin`（claude）と nvm bin（gemini）が解決できることを実機で確認
- README のトラブルシューティング「claude コマンドが見つかりません」を新挙動（起動時のログインシェル PATH 補完）に合わせて更新

### 設計判断

- マージ順は既存 PATH を先頭に維持（追記のみ）: E2E ハーネスが PATH 先頭に置く偽 CLI の隔離を崩さないため。詳細は architecture.md の設計判断履歴
- `-l` だけでなく `-i` も付ける: zsh は login だけでは .zshrc を読まず、nvm（gemini の実体がある）は .zshrc に書かれがちなため

### 教訓

- E2E ハーネスは PATH 差し替えで隔離しているため、「起動時に process.env.PATH を書き換える」変更は隔離を壊す危険と隣り合わせ。マージ順を決める前にハーネス（e2e/fixtures/harness.ts）を必ず読むこと
- 一時 ZDOTDIR のログインシェルは /etc/zprofile（path_helper）由来のシステム PATH しか返さないので、追記マージなら E2E に実害が出ない

### 次に再開するとき最初に読むべきこと

- 実装・自動検証・文書は完了。残るは「ユーザーが `make install-app` → Finder 起動で、タスク一覧のエラーが消え claude / gemini タブが起動すること」の実機確認のみ
- PR 作成まで済んでいれば、実機確認の結果を待って Issue #40 をクローズ判断（クローズはユーザー）
