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
| 設計 | 完了（22シナリオ・隔離方式・管理方式・CI 方針まで合意済み） |
| 実装 | 完了（`4d96cea` / `cdd54eb` でコミット済み。`cd76001` に E2E が見つけたアプリ側のバグ修正2件） |
| 検証 | 完了（2026-07-28 に再実行して確認。下記「検証結果」参照） |

### 検証結果（2026-07-28 実測）

| ゲート | 結果 |
|---|---|
| `make check`（typecheck + lint） | green |
| `make e2e` | 22 passed（45.7s） |
| `node scripts/lint-e2e.mjs` | PASS=166 FAIL=0 WARN=0 |
| `bash .claude/scripts/lint-skills.sh` | PASS=66 FAIL=0 |

---

## 4. 直近の次アクション

Issue #1 の完了条件は全て満たしている。残るのは取り込み作業と、Issue #1 の範囲外の宿題のみ。

| 優先度 | アクション | 詳細 |
|---|---|---|
| **P0** | `make dev` 描画不具合の修正を取り込む | `main.tsx` の xterm.css import（本命）と `useTerminal.ts` の WebglAddon 読み込み順。未コミット。詳細は worklog の 2026-07-28 |
| **P0** | `CLAUDE.md` の未コミット分を取り込む | `/e2e` の導線1行が `cdd54eb` から漏れて未コミットのまま残っている |
| P1 | WebGL レンダラを検証するシナリオの追加 | `known-issues.md` の 5 番。E2E が `--disable-gpu` 固定で描画経路に盲点がある |
| **P0** | `origin/main` へのリベース | PR #2 がマージ済み（`fe862f3`）。現ブランチは 3 ahead / 1 behind |
| P1 | PR の作成 | ユーザーの明示指示待ち |
| P1 | Phase 1 受け入れ基準の手動検証 | `known-issues.md` の 1 番。Issue #1 の範囲外だが P0 のまま残っている。vim / htop の描画と macOS の実 IME は人が触るしかない |

---

## 5. 関連ドキュメント

- 設計の全体像: `docs/PLAN.md`
- ターミナルの手動検証チェックリスト: `.claude/skills/terminal/operations/verify-terminal.md`
- 外部フォーマットの扱い: `.claude/skills/ai-cli/reference/external-formats.md`
