# Issue #40 パッケージ版（Finder 起動）で claude コマンドが見つからない - Overview

> **Issue**: [#40 パッケージ版（Finder 起動）で claude コマンドが見つからない](https://github.com/i-iwnl/ai-terminal/issues/40)
>
> Finder / Dock から起動した .app は launchd の最小 PATH しか継承しないため、`claude` / `gemini` / `tmux` が見つからない。Main プロセス起動時にログインシェルから PATH を取得して `process.env.PATH` にマージすることで、全 spawn / execFile 箇所を一括で直す。
>
> 詳細は以下の3ドキュメントに分割:
>
> - `architecture.md` - 触る構造・Contract変更・設計判断
> - `worklog.md` - 時系列の作業ログ・次に再開するとき最初に読むべきこと
> - `known-issues.md` - 判明した問題・未解決事項・先送りしたもの
>
> **最終更新**: 2026-07-29

---

## 1. ゴール

パッケージ版（Finder 起動）でも開発起動と同じように claude / gemini / tmux が PATH 上に見えるようにする。起動時に一度だけログインシェルの PATH を解決して `process.env.PATH` に反映し、取得失敗時は現状 PATH のまま縮退させる。

| カテゴリ | 対象 |
|---|---|
| 対象トラック | 単一（main） |
| ブランチ | `fix/issue-40-packaged-app-path` |
| 関連PR | 未作成 |

---

## 2. 完成条件

- [x] Finder から起動した安定版で、サイドバーのタスク一覧が PATH エラーなしで表示される（2026-07-29 ユーザー実機確認済み。shell-path.log で最小 PATH からの解決成功 907ms を裏取り）
- [x] Finder から起動した安定版で、claude / gemini タブが起動できる（同上）
- [x] PATH 解決の純粋関数に単体テストがある（`test/unit/shell-path.test.ts`）
- [x] `make check` / `make e2e` が green

---

## 3. 現状進捗

| 項目 | 状態 |
|---|---|
| 設計 | 完了 |
| 実装 | 完了（真因修正 e82d767 を含む） |
| 検証 | 完了（自動検証 + ユーザーの Finder 起動実機確認） |

---

## 4. 直近の次アクション

| 優先度 | アクション | 詳細 |
|---|---|---|
| **P0** | PR #41 のマージ（ユーザー判断） | マージで Issue #40 は Closes により自動クローズ |
