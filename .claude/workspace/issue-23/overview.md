# Issue #23 VoiceOver からターミナルの出力が一切読めない - Overview

> **Issue**: [#23 VoiceOver からターミナルの出力が一切読めない（screenReaderMode 未設定）](https://github.com/i-iwnl/ai-terminal/issues/23)
>
> `useTerminal.ts` の `new Terminal()` に `screenReaderMode` が無く、描画は WebGL レンダラ。
> 画面内容は canvas に描かれ **DOM にテキストが1文字も存在しない**ため、
> VoiceOver からはアプリの主コンテンツが完全に不在だった。
> 親 Issue [#20](https://github.com/i-iwnl/ai-terminal/issues/20) の Phase 0-c。
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

ターミナルの内容が支援技術から読める状態を選べるようにする。あわせて、**設定の存在を知らないユーザーでも読めるように**、VoiceOver の起動を検知して自動で有効にする。

| カテゴリ | 対象 |
|---|---|
| 対象トラック | main（支援技術の検知）+ renderer（xterm への反映と設定 UI）の2トラック |
| ブランチ | `feat/screen-reader-mode`（#22 の `feat/application-menu` の上に積む） |
| 関連PR | 未作成 |

---

## 2. 完成条件

- [x] `AppConfig.screenReaderMode` を追加した（既定 false）
- [x] 設定パネルから切り替えられる
- [x] 有効にすると xterm の読み上げ用要素が生え、出力が DOM のテキストとして読める
- [x] **VoiceOver の起動を検知したら、設定に関わらず有効になる**
- [x] 支援技術の状態が取れなくてもアプリが落ちない（false のまま続行）
- [x] E2E `S37` を追加し、**配線を外すと赤くなることを確認**した
- [x] 既定値が false であることを単体テストで固定した
- [x] `README.md` に使い方を書いた
- [x] 型チェック通過（`make check`）
- [x] Lintチェック通過（`make check`）
- [x] `make e2e` / `make e2e-lint` が通る

---

## 3. 現状進捗

| 項目 | 状態 |
|---|---|
| 設計 | 完了 |
| 実装 | 完了 |
| 検証 | 完了（実際の読み上げ品質のみ手動 -> `known-issues.md`） |

---

## 4. 直近の次アクション

| 優先度 | アクション | 詳細 |
|---|---|---|
| **P0** | PR を作成する | 実装・検証・文書更新は完了済み |
| P1 | 実機の VoiceOver で読み上げを確認する | `known-issues.md` の1番。自動では担保できない |
