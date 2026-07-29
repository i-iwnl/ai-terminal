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

---

## 2026-07-29 - 実機で再発 → 真因特定 → 修正（同日3周目）

### 実施内容

- ユーザーの実機確認で「まだ起こる」との報告。調査の結果、**初回実装の PATH 解決は一度も成功していなかった**
- 真因: 生成していたシェルコマンドが `printf '%s' "__AI_TERMINAL_PATH__$PATH__AI_TERMINAL_PATH__"` で、
  zsh が `$PATH__AI_TERMINAL_PATH__` 全体を1つの変数名として解釈（アンダースコアは変数名の有効文字）。
  未定義変数として空に展開され、閉じ目印ごと消えて切り出しが必ず失敗 → PATH がマージされない
- 修正: `${PATH}` とブレース付きで参照する `buildProbeCommand()` を純粋関数として切り出し、
  「`$PATH` の直後に英数字・アンダースコアが続かない」ことを単体テストで固定
- あわせて堅牢化3点: (1) 解決の成否・所要時間・結果 PATH を `~/.ai-terminal/shell-path.log` に毎回記録、
  (2) ポーリングが ENOENT を検知したら抑制付き（15秒間隔・最大5回）で再解決（`retryLoginShellPath`）、
  (3) タイムアウト 3s→5s + SIGKILL（対話モードの zsh は SIGTERM を無視することがある）
- claude.ts の `ClaudeAgentsResult` に `errorKind`（'not-found' | 'timeout' | 'failed'）を追加し、
  poller が文字列比較でなく種別で再解決を判断できるようにした（IPC 契約は変更なし）
- 検証: make check green（99件）、make e2e 38 passed、再インストール後の shell-path.log で「起動時解決: 成功（837ms）」を確認

### 設計判断

- 「起動時に一度だけ解決、失敗したら固定」をやめ、失敗を自己回復可能にした。原因が何であれ、
  一過性の失敗でアプリを再起動するまで壊れたままになる設計は脆い
- パッケージ版は stderr がどこにも出ないため、ファイルへの診断ログを常設した。今回の真因特定も
  このログが決め手だった（「Restored session」バナーの後、閉じ目印なしで出力が終わっている生データが見えた）

### 教訓

- **手動検証のコマンドは、コードが生成する文字列と一字一句同じものを使うこと。** 手で `${PATH}` や
  単独の `"$PATH"` を打って「動く」と確認していたが、生成コードは `"$PATH__目印__"` で別物だった。
  以後、シェルコマンドを組み立てるコードは文字列生成を純粋関数に切り出して単体テストで固定する
- **`open -a` は呼び出し元のシェルの環境変数（PATH 含む）をアプリに引き継ぐ。** 「Finder 起動の再現」に
  ならない。launchd の最小 PATH を再現するには本物の Finder / Dock 起動か launchctl 経由が必要。
  今回の調査が長引いた最大の原因（自分が起動したインスタンスではフル PATH が継承され、常に成功して見えた）
- ps ポーリングによる「プロセスが起動したか」の観測は、校正（自前で同コマンドを起動して捕捉率を確認）
  してから結論に使うこと

### 次に再開するとき最初に読むべきこと

- 真因修正済み・自動検証 green・PR #41 に追加コミット済み。残るは**ユーザー自身による Finder / Dock 起動での最終確認**
  （open -a では環境が本物にならないため、ユーザーの手での起動が唯一の最終検証）
- 確認できたら Issue #40 の完了コメント → ユーザーが PR マージ（Closes #40 で自動クローズ）

---

## 2026-07-29 - ユーザー実機確認 OK・作業完了（同日4周目）

### 実施内容

- ユーザーが Finder / Dock から安定版を起動し、タスク一覧が表示されることを確認（「見るようになりました」）
- shell-path.log で裏取り: 起動時の現在 PATH が `/usr/bin:/bin:/usr/sbin:/sbin`（launchd の最小 PATH）で、
  そこから解決成功（907ms）・`~/.local/bin` 等がマージされたことを確認。実環境での動作の決定的な証拠
- 完了条件4項目すべて達成。Issue #40 に完了コメントを書き戻し

### 次に再開するとき最初に読むべきこと

- 作業は完了。PR #41 のマージはユーザー判断（マージで Issue #40 は自動クローズ）
- 今後「claude コマンドが見つかりません」系の報告があったら、まず `~/.ai-terminal/shell-path.log` を見ること
