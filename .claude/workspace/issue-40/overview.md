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

- [ ] Finder から起動した安定版で、サイドバーのタスク一覧が PATH エラーなしで表示される（**要・ユーザーの実機確認**。launchd 相当の最小 PATH からの解決は実機で確認済み）
- [ ] Finder から起動した安定版で、claude / gemini タブが起動できる（同上）
- [x] PATH 解決の純粋関数に単体テストがある（`test/unit/shell-path.test.ts`）
- [x] `make check` / `make e2e` が green（S11 が1回 flaky → 単独5連続 green、既知の Issue #17 と同型と判断）

---

## 3. 現状進捗

| 項目 | 状態 |
|---|---|
| 設計 | 完了（起動時 PATH 解決・詳細は architecture.md） |
| 実装 | 完了（src/main/shell-path.ts 新設 + index.ts 組み込み） |
| 検証 | 自動検証は完了。Finder 起動の実機確認のみ残 |

---

## 4. 直近の次アクション

| 優先度 | アクション | 詳細 |
|---|---|---|
| **P0** | ユーザーが `make install-app` 後、Finder 起動で確認 | タスク一覧が PATH エラーなしで出る / claude・gemini タブが起動する |
