# Issue #20 UI/UX デザイン刷新の方針 - Overview

> **Issue**: [#20 UI/UX デザイン刷新の方針（5ペルソナのレビュー反映版）](https://github.com/i-iwnl/ai-terminal/issues/20)
>
> クローム（サイドバー・タブバー・通知・設定）のデザイン刷新。デザイン案を1本書いたうえで
> 5ペルソナのレビューエージェント（`/design-review`）に通し、指摘を反映した方針が Issue 本文。
> **Phase 0（デザイン以前に壊れているもの5件）は #21〜#25 として完了済み。**
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

トークン層を土台に、状態表現・タブ・通知・空状態・レイアウトを段階的に作り直す。
**1周ごとに独立してマージできる形に切り、画像の撮り直しを3回に集約する。**

| カテゴリ | 対象 |
|---|---|
| 対象トラック | 主に renderer。テーマ導出とウィンドウ状態は main も |
| ブランチ | PR ごとに切る（現在: `refactor/shared-defaults`） |
| 関連PR | #29 / #30 / #33 / #34 / #35（Phase 0）、以降は下表 |

---

## 2. 完成条件

Issue 本文の PR 分割表が唯一の正。ここでは進捗だけを持つ。

### Phase 0 — デザイン以前に壊れているもの（完了）

- [x] P0-a 状態の色と語の是正 -> [#21](https://github.com/i-iwnl/ai-terminal/issues/21) / PR #29
- [x] P0-b アプリケーションメニュー -> [#22](https://github.com/i-iwnl/ai-terminal/issues/22) / PR #30
- [x] P0-c screenReaderMode -> [#23](https://github.com/i-iwnl/ai-terminal/issues/23) / PR #33
- [x] P0-d 通知クリック + Dock バッジ -> [#24](https://github.com/i-iwnl/ai-terminal/issues/24) / PR #34
- [x] P0-e 設定を独立ウィンドウへ -> [#25](https://github.com/i-iwnl/ai-terminal/issues/25) / PR #35

### Phase 1 — トークン層（進行中）

- [x] PR 1 `src/shared/defaults.ts` へ既定値を寄せる（**見た目の変化ゼロ**）
- [x] PR 2 `:root` にトークンを宣言だけ追加（値は現行 hex と 1:1、使用箇所ゼロ）
- [ ] PR 3 面（surface / border）を変数へ置換。値据え置き
- [ ] PR 4 文字色・サイズ・余白を変数へ置換。値据え置き
- [ ] PR 5 **値の変更**（コントラスト是正・非テキスト 3:1・`prefers-contrast`）— 画像12枚

### Phase 2 以降

Issue 本文の表（PR 6〜20）を参照。着手時にここへ引き写す。

---

## 3. 現状進捗

| 項目 | 状態 |
|---|---|
| 設計 | 完了（5ペルソナのレビュー反映済み。Issue 本文が正） |
| 実装 | 進行中（Phase 0 完了、Phase 1 の PR 1 完了） |
| 検証 | 各 PR で完了 |

---

## 4. 直近の次アクション

| 優先度 | アクション | 詳細 |
|---|---|---|
| **P0** | PR 3（面と境界を変数へ置換）に着手する | 値は据え置き。画像0枚を維持する |
| P1 | 積んである5本の PR のマージと base 繰り上げ | #29 -> #30 -> #33 -> #34 -> #35 |
| P2 | 実機確認3件を消化する | #22 の二重発火 / #23 の VoiceOver / #24 の通知クリック |
