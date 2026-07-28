# Issue #27 electron-builder による安定版パッケージングと dev/安定版のデータ保存先分離 - Overview

> **Issue**: [#27 electron-builder による安定版パッケージングと dev/安定版のデータ保存先分離](https://github.com/i-iwnl/ai-terminal/issues/27)
>
> `make dev` 中の再起動で PTY セッションが途切れる問題への対処として、リポジトリから独立した安定版 .app を `make package` で作れるようにする。あわせて dev 実行時（非パッケージ時）の userData / `~/.ai-terminal` を `-dev` サフィックスへ分離し、安定版との同時起動で保存先が衝突しないようにする。
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

`make package` 一発で署名要件を満たしたローカル用 .app が `dist/` にでき、日常のエージェント飼育は安定版・開発は `make dev` という並走運用を成立させる。データ保存先（Electron userData と `~/.ai-terminal` 配下の config/memos/session-titles）は実行形態で自動的に分かれ、E2E の隔離ハーネスは従来どおり動く。

| カテゴリ | 対象 |
|---|---|
| 対象トラック | 単一（main + ビルド設定。renderer は触らない） |
| ブランチ | worktree-issue-27-stable-package（`.claude/worktrees/issue-27-stable-package/` のワークツリー） |
| 関連PR | 未作成 |

---

## 2. 完成条件

- [x] `make package` で .app が生成され、ダブルクリック（open）で起動できる（2026-07-29 実起動で確認）
- [x] パッケージ版と `make dev` を同時起動しても userData と `~/.ai-terminal` が衝突しない（dev は `-dev` サフィックス。実起動で確認）
- [x] `make check` 通過（67件 green）
- [x] `make e2e` green（35 シナリオ。ハーネスは `AI_TERMINAL_DATA_DIR` 1行の追加のみ）
- [x] README に安定版の作り方・使い方が載っている

---

## 3. 現状進捗

| 項目 | 状態 |
|---|---|
| 設計 | 完了（architecture.md 参照） |
| 実装 | 完了 |
| 検証 | 完了（check / e2e / e2e-lint / package / 実起動） |

---

## 4. 直近の次アクション

| 優先度 | アクション | 詳細 |
|---|---|---|
| **P0** | commit / PR 作成 | **ユーザーの明示指示待ち**（ワークツリーに未コミットで置いてある） |
| P3 | アプリアイコンの追加 | known-issues.md 1番（GitHub Issue 起票済み） |
