# Issue #253 Claude Code セッションから起動した .app では、タブ内で起動した claude が一覧にも履歴にも出ない - Overview

> **Issue**: [#253 Claude Code セッションから起動した .app では、タブ内で起動した claude が一覧にも履歴にも出ない（親セッションの env を継承している）](https://github.com/i-iwnl/ai-terminal/issues/253)
>
> `.app` を Claude Code セッションの中から起動すると、親セッションの状態を表す環境変数
> （`CLAUDE_CODE_CHILD_SESSION` 等）がアプリの `process.env` に焼き付き、`buildPtyEnv` が
> それを全タブの子プロセスへ配る。受け取った `claude` は自分を「子セッション」と判定して
> `~/.claude/sessions/<pid>.json` を書かないため、`claude agents --json` に出ず、
> 一覧にも履歴にも現れない。
>
> 詳細は以下の3ドキュメントに分割:
>
> - `architecture.md` - 触る構造・Contract変更・設計判断
> - `worklog.md` - 時系列の作業ログ・次に再開するとき最初に読むべきこと
> - `known-issues.md` - 判明した問題・未解決事項・先送りしたもの
>
> **最終更新**: 2026-08-14

---

## 1. ゴール

ai-terminal が「自分を起動した Claude Code セッションの子ではない」ことを、起動直後に
`process.env` の上で確定させる。以後に走るログインシェル解決・PTY 起動・`claude agents --json`
のすべてが、その確定済みの env を見るようにする。

| カテゴリ | 対象 |
|---|---|
| 対象トラック | 単一（`src/main/`） |
| ブランチ | 未作成 |
| 関連PR | 未作成 |

---

## 2. 完成条件

- [x] 親セッション状態キー（10個）を `process.env` から落とす純粋関数があり、単体テストで固定されている
- [x] 落とす処理が `ensureLoginShellPath()` より前に走る（ログインシェル解決の探索シェルにも波及しない）
- [x] 利用者が `~/.zshrc` 等で設定した同名キーは PTY に届く（`mergeUserEnv` が埋め直せる）
- [x] 親セッションのマーカーを持つ env でアプリを起動しても、シェルタブの中で当該変数が空である（S120）
- [x] 実機確認: マーカー付き env で起動したアプリのタブ内で `claude` を起動し、`claude agents --json` と「このマシン全体の AI」の両方に出る
- [x] 型チェック通過（`make check`）
- [x] Lintチェック通過（`make check`）

---

## 3. 現状進捗

| 項目 | 状態 |
|---|---|
| 設計 | 完了 |
| 実装 | 完了 |
| 検証 | 完了（`make check` / `make e2e` / `make e2e-lint` / 実機） |

---

## 4. 直近の次アクション

| 優先度 | アクション | 詳細 |
|---|---|---|
| **P0** | commit / push / PR | **利用者の明示指示待ち**（ルート CLAUDE.md）。ブランチ `fix/253-inherited-agent-env` |
| P1 | push 直前に `make e2e` と `make e2e-lint` を通し直す | 撮影レーンは不要（UI・CSS・DOM 非変更） |
