# Issue #22 アプリケーションメニューが未実装で、Cmd+R でタブが全消失しうる - Overview

> **Issue**: [#22 アプリケーションメニューが未実装で、Cmd+R でタブが全消失しうる](https://github.com/i-iwnl/ai-terminal/issues/22)
>
> `Menu.setApplicationMenu` を一度も呼んでおらず、Electron の既定メニューのまま動いていた。
> View > Reload（`Cmd+R`）が生きており、押すと**全タブの xterm とスクロールバックが消える**。
> あわせてショートカットがメニューバーに1つも載っておらず、`Cmd+K` が他ターミナルの
> 「画面を消去」を奪っていた。親 Issue [#20](https://github.com/i-iwnl/ai-terminal/issues/20) の Phase 0-b。
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

押し間違いでユーザーの状態が壊れる経路を塞ぎ、ショートカットを発見可能にする。あわせて `Cmd+K` を他のターミナルと同じ「画面を消去」に戻す。

| カテゴリ | 対象 |
|---|---|
| 対象トラック | main（メニュー）+ renderer（操作の実行）の2トラック |
| ブランチ | `feat/application-menu`（#21 の `fix/task-status-color-and-wording` の上に積む） |
| 関連PR | 未作成 |

---

## 2. 完成条件

- [x] `Cmd+R` で Renderer が再読み込みされない（本番のメニューに reload / DevTools が無い）
- [x] 主要な操作がメニューに載り、キーが表示される
- [x] `Cmd+K` が「画面を消去」になり、AI CLI の起動は `Cmd+Shift+C` / `Cmd+Shift+G` に移った
- [x] メニューから選んだ操作が Renderer に届く（menu -> IPC -> App）
- [x] メニューとキーボードが同じ `AppAction` を通る（処理が1本に集約されている）
- [x] E2E `S36` を追加し、**メニュー未登録の状態で赤くなることを確認**した
- [x] `README.md` のショートカット表が実装と一致している
- [x] E2E の `Meta+k` / `Meta+Shift+K` を新しいキーに追従させた
- [x] `docs/images/S09-launch-claude.png` を撮り直した
- [x] 型チェック通過（`make check`）
- [x] Lintチェック通過（`make check`）
- [x] `make e2e` / `make e2e-lint` が通る

---

## 3. 現状進捗

| 項目 | 状態 |
|---|---|
| 設計 | 完了 |
| 実装 | 完了 |
| 検証 | 完了（ただし二重発火のみ手動確認が残る -> `known-issues.md`） |

---

## 4. 直近の次アクション

| 優先度 | アクション | 詳細 |
|---|---|---|
| **P0** | PR を作成する | 実装・検証・文書更新は完了済み |
| P1 | 実機で `Cmd+T` を押し、タブが1枚だけ開くことを確認する | `known-issues.md` の1番。E2E では検出できない |
