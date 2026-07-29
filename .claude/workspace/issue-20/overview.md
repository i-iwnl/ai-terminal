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
- [x] PR 3 面（surface / border）を変数へ置換。値据え置き
- [x] PR 4 文字色・状態色・アクセント・サイズ・余白を変数へ置換。値据え置き（**置換はここで完了**）
- [x] PR 5 **値の変更**。5ペルソナのレビューで前提が4つ覆り、1 PR を 7 PR に分割した
  - [x] 5-0 関門を作る（既定色の正を1本化 / S40 コントラスト契約 / CI に unit）— PR #45
  - [x] 5-1 フォントサイズを6段から4段へ — PR #46
  - [x] 5-2 面を10トークンから5トークンへ — PR #47
  - [x] 5-3 文字色を9種類から4段へ（全段 AA）— PR #48
  - [x] 5-4 枠を1本に畳んで 3:1 に載せる + アクセント・状態・エラー帯 — PR #49
  - [x] 5-5 フォーカスリング — PR #50
  - [x] 5-6 `prefers-contrast: more` + S41 — PR #51
  - [x] 5-7 画像12枚の撮り直し + README

### Phase 2 以降 — 全 14 本が未着手（2026-07-29 に実コードで確認）

Issue 本文の表（PR 6〜20）が正。**PR 7 は Phase 0 の #25 / PR #35 で前倒し完了済み**なので、
残りは **PR 6, 8〜20 の 14 本**。着手時に個別の行をここへ引き写す。

| PR | 内容 | 未着手の裏取り |
|---|---|---|
| 6 | Target Size 24x24 | `styles.css` に 24px の `min-height` / `min-width` が1つも無い |
| 8 | タスク行の再設計 | `TaskList.tsx` にグループ見出し・待たせている時間・ソートが無い |
| 9 | `<li onClick>` 解体 + `role="tablist"` | `TaskList.tsx:85` に `<li onClick>` が現存。`role="tab"` は 0 件 |
| 10 | タブマーカー + `basename(cwd)` | `TabBar.tsx:119` は `tab.title` をそのまま出している |
| 11 | 通知バナー severity 化・配列化 | `App.tsx:214` は単一の `notice` 文字列のみ |
| 12 | 空状態の次の行動 + `+ ▾` | 「タブがありません」等、次の行動への導線が無い |
| 13 | スコープ行 + 設定セクション切り直し | 該当 DOM 無し |
| 14 | キーボード（J）+ `Cmd+Opt` 解禁 | — |
| 15 / 16 | サイドバー折りたたみ / ドラッグリサイズ | `collapse`・幅の永続化のコードが 0 件 |
| 17 / 18 | `src/shared/theme.ts` + テーマ切替 UI | `src/shared/` に `theme.ts` が存在しない |
| 19 | 密度・タイポ + vibrancy | `vibrancy` が 0 件 |
| 20 | ウィンドウ上端の統一 + フルスクリーン | `menu.ts:59` の `togglefullscreen` のみ |

**PR 8 / 10 / 13 は [#58](https://github.com/i-iwnl/ai-terminal/issues/58)（cwd の固定）の決着待ち。**
3本とも cwd を画面に出す提案で、全タブ同一・起動時固定のままでは全行に同じ値が並ぶだけになる。

---

## 3. 現状進捗

| 項目 | 状態 |
|---|---|
| 設計 | 完了（5ペルソナのレビューを2周反映。**値の根拠は Issue 本文ではなく S40 の実測が正**） |
| 実装 | **Phase 0 と Phase 1 が完了。** 次は Phase 2 |
| 検証 | 各 PR で完了（S40 / S41 が配色の関門として常設） |

---

## 4. 直近の次アクション

| 優先度 | アクション | 詳細 |
|---|---|---|
| **P0** | **選択中タブに下線を足す** | Phase 1 でただ1つ閾値に届かなかった箇所（塗り 1.23）。塗りをどう選んでも 3:1 には届かないので、構造で解くしかない。`.sidebar__tabs button.is-active` に同じ手法の前例がある |
| P1 | ウィンドウ上端の帯の高さを揃える | サイドバー 40px とタブバー 36px で 4px の段差。信号機の光学中心 y=22 とも合っていない。`--surface-tabbar` を畳んだので継ぎ目が見える状態 |
| P1 | 実機確認3件を消化する | #22 の二重発火 / #23 の VoiceOver / #24 の通知クリック |
| P1 | **cwd の固定を決着させる** | [#58](https://github.com/i-iwnl/ai-terminal/issues/58)。**PR 8 / 10 / 13 の前提**。Finder 起動で履歴タブが空になる実害もある |
| P2 | `Cmd+B` でサイドバーを畳む | **別 Issue に切る。** 原則3「クロームの既定は 0px」と実装が矛盾している。効果は端末の 22% |
| P2 | `selectionBackground` #264f78（対背景 2.03） | Phase 1 の非目標として送ったもの。#2f5d8f（2.53）案あり |
