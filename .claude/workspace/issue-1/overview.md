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
> **最終更新**: 2026-07-28

---

## 1. ゴール

ビルド済みの Electron アプリを Playwright で駆動し、実 OS への依存を隔離した状態で22シナリオを自動検証できるようにする。あわせて、シナリオとテストファイルの 1:1 を機械的に強制し、撮影したスクリーンショットから README の使い方ガイドを生成する。

| カテゴリ | 対象 |
|---|---|
| 対象トラック | 単一（テストコードが主。E2E が見つけたアプリ本体のバグ修正2件のみ `src/` に入った） |
| ブランチ | `feat/e2e-playwright`（`origin/main` に対し 3 commits ahead / 1 behind） |
| 関連PR | 未作成 |

---

## 2. 完成条件

Issue #1 の完了条件と同一。ここでは実装観点で再掲する。

- [x] 隔離ハーネス（一時 HOME + 偽 CLI + フィクスチャ）が動作し、実データに依存しない
- [x] S01 から S22 まで全 spec が green（当初21件 + IME の S22 を追加）
- [x] `scripts/lint-e2e.mjs` がシナリオと spec の 1:1 を検査し exit 0
- [x] README に画像付きの使い方ガイドが追加されている
- [x] `.claude/skills/e2e/` が生成されている
- [x] 型チェックと Lint 通過（`make check`）
- [x] `bash .claude/scripts/lint-skills.sh` が exit 0

---

## 3. 現状進捗

| 項目 | 状態 |
|---|---|
| 設計 | 完了（23シナリオ・隔離方式・管理方式・CI 方針まで合意済み） |
| 実装 | 完了。`main` にマージ済み（PR #3）。S23 のみ `test/webgl-e2e-and-phase1-verify` で作業中 |
| 検証 | 完了（下記「検証結果」参照）。Phase 1 受け入れ基準も 8項目中7項目を確認済み |

### 検証結果（2026-07-28 実測）

| ゲート | 結果 |
|---|---|
| `make check`（typecheck + lint） | green |
| `make e2e` | **25 passed（1.2 分・flaky 0・exit 0）** |
| `node scripts/lint-e2e.mjs` | PASS=187 FAIL=0 WARN=0 |
| `bash .claude/scripts/lint-skills.sh` | PASS=66 FAIL=0 |

---

## 4. 直近の次アクション

Issue #1 の完了条件は全て満たしており、`main` にマージ済み（PR #3）。残るのは人手か環境整備が要る2件のみ。

**残タスクは GitHub Issue に起票済み。** 状態の唯一の正は Issue 側で、ここは索引に留める。

| Issue | 優先度 | アクション |
|---|---|---|
| [#7](https://github.com/Yoshinaga-iwnl/ai-terminal/issues/7) | P2 | 実機の IME で日本語入力を確認する（**人手でしか確認できない**唯一の残項目） |
| [#8](https://github.com/Yoshinaga-iwnl/ai-terminal/issues/8) | P1 | IME の入力側が自動検証の対象外であることを README に明記する |
| [#15](https://github.com/Yoshinaga-iwnl/ai-terminal/issues/15) | P3 | tmux 永続化の検証手段（`deferred`） |
| [#16](https://github.com/Yoshinaga-iwnl/ai-terminal/issues/16) | P3 | macOS 通知の発火を検証する手段（`deferred`） |

PR #4 はマージ済み（2026-07-28）。「htop を入れて確認する」はチェックリストを性質ベースへ書き換えた際に消えた（固有のコマンド名ではなく「全画面 TUI が崩れないこと」を S24 が担保する）。

### 片付いたもの（2026-07-28）

| 項目 | 結果 |
|---|---|
| `make dev` 描画不具合（xterm.css の import 漏れ） | 修正して `main` にマージ済み（PR #3） |
| `CLAUDE.md` の `/e2e` 導線漏れ | 同上 |
| `origin/main` へのリベース | PR #3 のマージで解消 |
| WebGL レンダラを検証するシナリオ | S23 として追加。不具合を注入すると赤くなることも確認済み |
| Phase 1 受け入れ基準の検証 | 8項目中7項目 OK（`known-issues.md` の 1 番に結果表） |

---

## 5. 関連ドキュメント

- 設計の全体像: `docs/PLAN.md`
- ターミナルの手動検証チェックリスト: `.claude/skills/terminal/operations/verify-terminal.md`
- 外部フォーマットの扱い: `.claude/skills/ai-cli/reference/external-formats.md`
