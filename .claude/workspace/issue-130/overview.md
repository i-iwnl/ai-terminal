# Issue #130 分割中のペインに名前を付けられるようにする（ヘッダ表示 + メニュー導線） - Overview

> **Issue**: [#130 分割中のペインに名前を付けられるようにする（ヘッダ表示 + メニュー導線）](https://github.com/i-iwnl/ai-terminal/issues/130)
>
> 分割したペインそれぞれに名前を付け、そのペインのヘッダに出す。
> 動機は「複数のペインを並べていると、どのペインで何をしていたかを忘れる」。
> **名前を付ける機能は着手前から既にあった**（当時 `renameTab` という名前だった関数が
> `tabLeaf(t).paneId` に書き込んでおり、`PaneLeaf.title` が実体）。足りなかったのは
> **付けた名前がペインに出ていないこと**。関数は `renamePane(tabId, paneId, title)` へ改名済み。
>
> 詳細は以下の3ドキュメントに分割:
>
> - `architecture.md` - 触る構造・Contract変更・設計判断
> - `worklog.md` - 時系列の作業ログ・次に再開するとき最初に読むべきこと
> - `known-issues.md` - 判明した問題・未解決事項・先送りしたもの
>
> **最終更新**: 2026-08-04

---

## 1. ゴール

`paneHeader.ts` の `paneHeaderLabel()` に分岐を1本入れ、`leaf.title` がユーザーによって
変更されていればそれを出す。あわせて `title` 属性と `aria-label` を整え、
リネームの導線を `menu.ts` に置く。

**CSS を1行も触らない**のがこの Issue の設計上の制約（画像の撮り直しを発生させない）。

| カテゴリ | 対象 |
|---|---|
| 対象トラック | 単一（renderer 中心。main は `menu.ts` の1項目追加のみ） |
| ブランチ | 未作成 |
| 関連PR | 未作成 |

---

## 2. 完成条件

Issue 本文の完了条件と1:1。**判定は観測可能な形で書く。**

- [x] 名前を付けていないペインのヘッダが、現状と1文字も変わらない（`zsh・demo-project`）
- [x] 名前を付けたペインのヘッダに、その名前が出る
- [x] 分割した2枚に別々の名前を付けると、2枚のヘッダに別々の名前が同時に出る
- [x] ヘッダに `title` 属性が付き、幅が足りずに省略されても全文が読める
- [x] `role="group"` の `aria-label` に、名前と種別・cwd の両方が入る
- [x] 「表示」メニューの `ペイン名を変更...` からリネームの入力欄が開き、アクティブなペインの名前が変わる
- [x] `.pane-header` の高さ・色・CSS を1行も変えていない（`docs/images/` の差分が0枚）
- [x] 露出している live region が1個のまま（S37 / S48 が green）
- [x] 純粋関数の分岐が `test/unit/pane-header.test.ts` で検証されている
- [x] E2E で「分割した2枚に別々の名前が出る」が検証されている（**先に赤くなることを確認する**）
- [x] README にペイン名の変更方法が載っている
- [x] 型チェック通過（`make check`）
- [x] Lintチェック通過（`make check`）
- [x] `make e2e` / `make e2e-lint` が通る

---

## 3. 現状進捗

| 項目 | 状態 |
|---|---|
| 設計 | 完了（`/design-review` を5ペルソナで実施し、初版の前提が4件覆った。結論は Issue 本文が正） |
| 実装 | **完了** |
| 検証 | **完了**（`make check` / `make e2e` 95 passed / `e2e-lint` FAIL=0 / 画素検査 全枚数 差0） |

### 周の計画

| 周 | 内容 | 状態 |
|---|---|---|
| 1 | `paneHeaderLabel` の分岐 + `paneAccessibleLabel` 新設 + unit（7 -> 18 ケース） | **完了** |
| 2 | ヘッダの表示・`title` 属性・`aria-label` を配線 | **完了** |
| 3 | `AppAction` に `rename-active-pane` + `menu.ts` の「表示」に項目 + `renameTab` -> `renamePane` | **完了** |
| 4 | README 更新 + S85 追加 + 記録 | **完了** |

---

## 4. 直近の次アクション

| 優先度 | アクション | 詳細 |
|---|---|---|
| **P0** | commit / push / PR | **ユーザーの明示指示待ち**（CLAUDE.md の Git 操作規約。エージェントが自発的にコミットしない） |
| P1 | `known-issues.md` の X1〜X9 を GitHub Issue に起こす | `/workspace-plan promote-known-issues`。特に **X1（`Cmd+J` がペインに着地しない）** は削減手数がこの Issue の全周より大きいという評価 |
| P2 | S57（既存のペインヘッダ spec）に「主が空でない」assert を足すか検討する | 現状の `toContainText` は主スロットが常に空でも green になる（保守ペルソナの指摘）。S85 が別経路で担保しているので急がない |
