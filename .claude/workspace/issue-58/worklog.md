# Worklog

時系列の作業ログ。**設計判断の根拠**と**学んだ教訓**を中心に記録する。
コード差分は git log を参照、現状の構造は `architecture.md` を参照。

---

## 2026-07-29 - cwd をタブ単位で追跡する（実装から検証まで1周）

### 実施内容

- Main に「PID から作業ディレクトリを読む」経路を新設（`src/main/pty/cwd.ts`）。macOS は `lsof -a -d cwd -p <pid> -Fn`、Linux は `/proc/<pid>/cwd` の readlink
- IPC を1本追加（`pty:cwd`）。preload と `RendererApi.pty.cwd()` まで4ステップを通した
- Renderer 側を「起動時に1回だけ解決する共有 cwd」から「アクティブなタブの cwd」へ作り替え
  - `TabState.cwd` が唯一の正。アクティブなシェルタブだけ 2 秒間隔でポーリングし、変化したら共有値へ反映
  - `newAgentTab()` は spawn の直前に問い合わせ直す（記録済みの値だと `cd` の1回分だけ古くなる）
  - 履歴一覧は cwd の変化で再読み込み。タスク一覧は既に購読していたのでそのまま効いた
- Finder / Dock 起動で `process.cwd()` が `/` になる場合をホームへ倒す（`resolveLaunchCwd`）
- 単体テスト 11 件（`parseLsofCwd` 7 / `resolveLaunchCwd` 4）、E2E に S43 を追加
- README の「AI エージェントを起動する」「設定」に、`cd` へ追従することを明記

### 設計判断

判断の一覧と根拠は `architecture.md` の「設計判断履歴」が唯一の正。要点だけ:

- **OSC 7 を採らなかった。** macOS 既定の zsh は OSC 7 を出さない（Apple_Terminal のときだけ `/etc/zshrc_Apple_Terminal` が出す）。出させるにはユーザーの `.zshrc` を書き換えるか、PTY の出力を横取りして解釈することになり、どちらも鉄則2の周辺にある。**OS にプロセスの cwd を聞けば、シェル側に何も仕込まずに済み、`cd` 以外の移動（`pushd`・スクリプト経由）も同じ経路で拾える**
- **`setSharedCwd()` に「値が変わっていなければ通知しない」ガードを入れた。** これが無いと 2 秒ごとに履歴一覧とタスク一覧が再取得され続ける。**追従をポーリングで作る以上、変化検知は通知側の責務**
- **Finder 起動のフォールバックはホームまで。** 「最後に使ったディレクトリを永続化する」案は、cwd が追跡されるようになった時点で「起動直後の1枚目のシェルタブ」だけの問題に縮小したので入れなかった

### 教訓

- **`process.cwd()` を `getAppPaths()` に差し替えたとき、import を書き忘れて2つのワーカーが同時に同じ指摘を返してきた。** 型チェックを回す前に別の作業へ進んだのが原因。**1ファイルの編集でも、次のファイルへ移る前に typecheck を回すほうが結局速い**
- **E2E の「壊したら赤くなるか」は、壊し方を間違えると意味を持たない。** 今回は初回の1回だけ呼ぶ `refreshTabCwd` を残したままポーリングだけを止めて赤を確認した。初回呼び出しごと消すと「`cd` を追跡しない」ではなく「そもそも cwd を読まない」を検証してしまい、修正前の状態とは違うものを見ることになる
- **他セッションが作った git worktree（`.claude/worktrees/`）を eslint が拾い、`make check` の lint が 226 件のエラーで落ちた。** 変更内容とは無関係。`--ignore-pattern '.claude/worktrees/**'` を付けた eslint は clean。`known-issues.md` の 3 に記録した

### 次に再開するとき最初に読むべきこと

1. **この Issue の完了条件はすべて満たしている。** `overview.md` の完成条件と、S43 が green であることを確認済み
2. **`make check` の lint は、他セッションの worktree が `.claude/worktrees/` に残っている間は落ちる**（`known-issues.md` の 3）。判定に使うなら `npx eslint . --ignore-pattern '.claude/worktrees/**'`
3. 次は **Issue #20 の Phase 2**。PR 8（タスク行に `basename(task.cwd)`）/ PR 10（タブタイトルを `basename(cwd)`）/ PR 13（スコープ行）は、いずれも「cwd がタブごとに動く」ことが前提で、その前提が今回そろった
4. 分割表示（#56）を入れるときは `known-issues.md` の 2 を先に読む。**ポーリング対象が「アクティブなタブ1枚」である前提が、ペインが増えると崩れる**

---

<!-- 以降、作業のたびにセクションを追記 -->
