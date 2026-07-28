# Issue #24 通知をクリックしても該当タブへ飛べない／Dock バッジが無い - Overview

> **Issue**: [#24 通知をクリックしても該当タブへ飛べない／Dock バッジが無い](https://github.com/i-iwnl/ai-terminal/issues/24)
>
> アプリは「あなたの番になった瞬間」を既に検知して通知しているのに、出口が無かった。
> `notification.on('click')` が無く、`app.setBadgeCount` の呼び出しもリポジトリ内にゼロ。
> 親 Issue [#20](https://github.com/i-iwnl/ai-terminal/issues/20) の Phase 0-d。
>
> あわせて、[issue-21 の known-issues 1番](../issue-21/known-issues.md)（状態判定が UI と
> poller で二重化している）を前提として解消する。**この Issue で判定が3箇所目になるため。**
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

「あなたの番になった」ことを、**アプリを見ていないときにも**伝え、1手でその場所へ行けるようにする。あわせて状態判定の唯一の正を作る。

| カテゴリ | 対象 |
|---|---|
| 対象トラック | shared（状態判定）+ main（通知・Dock）+ renderer（タブのフォーカス）の3トラック |
| ブランチ | `feat/notify-click-and-dock-badge`（#23 の上に積む） |
| 関連PR | 未作成 |

---

## 2. 完成条件

- [x] 状態判定の唯一の正が `src/shared/agent-status.ts` にあり、表示・通知・Dock バッジが共有している
- [x] 通知をクリックするとウィンドウが前に出て、該当セッションのタブがアクティブになる
- [x] Dock バッジに「あなたの番」の件数が出る（総数ではない）
- [x] Dock バッジが `notifyOnIdle`（通知の有無）とは独立して動く
- [x] 非フォーカス時に「あなたの番」へ遷移したら Dock が弾む
- [x] 未知の status を片側に丸めない（`becameYourTurn` / `countYourTurn` の単体テストで固定）
- [x] E2E `S38` を追加し、**バッジを総数に変えると赤くなることを確認**した
- [x] 型チェック通過（`make check`）
- [x] Lintチェック通過（`make check`）
- [x] `make e2e` / `make e2e-lint` が通る

---

## 3. 現状進捗

| 項目 | 状態 |
|---|---|
| 設計 | 完了 |
| 実装 | 完了 |
| 検証 | 完了（通知クリックの実操作のみ手動 -> `known-issues.md`） |

---

## 4. 直近の次アクション

| 優先度 | アクション | 詳細 |
|---|---|---|
| **P0** | PR を作成する | 実装・検証・文書更新は完了済み |
| P1 | 実機で通知をクリックして、該当タブへ飛ぶことを確認する | `known-issues.md` の1番。OS 通知は自動化できない |
