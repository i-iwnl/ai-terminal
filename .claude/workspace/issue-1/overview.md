# Issue #1 E2E テスト基盤の構築（Playwright + 隔離ハーネス） - Overview

> **Issue**: [#1 E2E テスト基盤の構築（Playwright + 隔離ハーネス）](https://github.com/Yoshinaga-iwnl/ai-terminal/issues/1)
>
> MVP の実装は完了しているが自動テストが1本も無い。実際に「ウィンドウは開くが何も動かない」不具合を2件作り込み、DevTools を開くまで気づけなかった。Playwright の Electron 起動 API で回帰を機械的に検出できる状態にする。
>
> 詳細は以下の3ドキュメントに分割:
>
> - `architecture.md` - 触る構造・Contract変更・設計判断
> - `worklog.md` - 時系列の作業ログ・次に再開するとき最初に読むべきこと
> - `known-issues.md` - 判明した問題・未解決事項・先送りしたもの
>
> **最終更新**: 2026-07-27

---

## 1. ゴール

ビルド済みの Electron アプリを Playwright で駆動し、実 OS への依存を隔離した状態で21シナリオを自動検証できるようにする。あわせて、シナリオとテストファイルの 1:1 を機械的に強制し、撮影したスクリーンショットから README の使い方ガイドを生成する。

| カテゴリ | 対象 |
|---|---|
| 対象トラック | 単一（テストコードのみ。アプリ本体 `src/` は変更しない） |
| ブランチ | 未作成（現状 main で作業） |
| 関連PR | 未作成 |

---

## 2. 完成条件

Issue #1 の完了条件と同一。ここでは実装観点で再掲する。

- [ ] 隔離ハーネス（一時 HOME + 偽 CLI + フィクスチャ）が動作し、実データに依存しない
- [ ] S01 から S21 まで全 spec が green
- [ ] `scripts/lint-e2e.mjs` がシナリオと spec の 1:1 を検査し exit 0
- [ ] README に画像付きの使い方ガイドが追加されている
- [ ] `.claude/skills/e2e/` が生成されている
- [ ] 型チェックと Lint 通過（`make check`）
- [ ] `bash .claude/scripts/lint-skills.sh` が exit 0

---

## 3. 現状進捗

| 項目 | 状態 |
|---|---|
| 設計 | 完了（21シナリオ・隔離方式・管理方式・CI 方針まで合意済み） |
| 実装 | 進行中（`@playwright/test@1.62.0` の導入のみ。未コミット） |
| 検証 | 未着手 |

---

## 4. 直近の次アクション

| 優先度 | アクション | 詳細 |
|---|---|---|
| **P0** | 隔離ハーネスの実装 | `e2e/fixtures/` に偽 `claude` / `gemini`、一時 HOME の生成、`config.json` と JSONL フィクスチャ。ここが全 spec の共通基盤なので直列で作る |
| **P0** | `e2e/scenarios.yml` の作成 | シナリオの唯一の正。spec より先に確定させる |
| P1 | spec の実装（S01-S21） | ハーネス確定後に3グループへ並列委譲できる（起動/タブ、AI CLI/サイドバー、履歴/その他） |
| P1 | `scripts/lint-e2e.mjs` | シナリオと spec の 1:1 検査 |
| P2 | スクリーンショット撮影と README 更新 | spec が green になってから |
| P2 | `.claude/skills/e2e/` の生成 | 最後。確定した運用を記録する |

---

## 5. 関連ドキュメント

- 設計の全体像: `docs/PLAN.md`
- ターミナルの手動検証チェックリスト: `.claude/skills/terminal/operations/verify-terminal.md`
- 外部フォーマットの扱い: `.claude/skills/ai-cli/reference/external-formats.md`
