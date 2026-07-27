# Init - ワークスペースの新規作成

Issue番号をキーにワークスペースを作成する手順。

## トリガー

- ユーザーが「Issue #<番号> の作業を始めたい」「ワークスペースを作って」と言ったとき
- 引数: **Issue番号（必須）**。省略された場合はユーザーに確認する（推測で採番しない）

## 手順

### 1. Issueの内容を取得する

```bash
gh issue view <Issue番号> --json title,body,labels,url
```

取得した `title` / `labels` / `url` は `overview.md` にそのまま転記してよい。`body` は**要約のみ**を書く（丸ごとコピーしない。本文が変わったときに二重管理になるのを防ぐため、詳細は常にIssueへのリンクを辿らせる）。

`gh` が失敗した場合（権限・ネットワーク等）は、取得できた範囲（Issue番号のみ等）で縮退させ、ユーザーに手動での情報提供を依頼する。アプリを止めない。

### 2. ディレクトリの作成

```bash
mkdir -p .claude/workspace/issue-<Issue番号>
```

既に `.claude/workspace/issue-<Issue番号>/` が存在する場合は、上書きせずユーザーに確認する（`update` を促す）。

### 3. 対象範囲の確認

- 単一トラックが既定。`src/main/`（PTY / agents / history）と `src/renderer/`（React UI）の両方に広くまたがる規模の大きいタスクのみ、`main` / `renderer` の2トラックに分けることを検討し、`architecture.md` に記録する。
- `src/shared/ipc.ts`（IPCのチャンネル名と型）を変更する見込みがあるかを確認する。変更する場合は **Contract** として `architecture.md` の「スキーマ / Contract 変更」節に明記する。

### 4. 規約・ドメインskillの確認

対象範囲に応じて、実装前に読むべき規約を確認する（この一覧が唯一の正。他所にコピーしない）:

| 対象範囲 | 読むもの |
|---|---|
| IPCチャンネルの追加・変更、preload / contextBridge | [/electron-ipc](../../electron-ipc/SKILL.md) |
| claude / gemini CLIの起動・出力パース | [/ai-cli](../../ai-cli/SKILL.md) |
| xterm.js / node-pty まわり | [/terminal](../../terminal/SKILL.md) |
| 上記に当てはまらない変更 | ルート [CLAUDE.md](../../../../CLAUDE.md) のアーキテクチャの鉄則・コーディング規約と、既存コードの近傍パターン |

### 5. ワークスペースファイルの生成

以下の4ファイルをテンプレート（`.claude/skills/workspace-plan/reference/` 配下）に基づいて生成する:

| ファイル | 役割 | テンプレート |
|---|---|---|
| `overview.md` | 何を・なぜ（Issueへのリンクと要約）・完了条件・現状進捗 | [overview-template.md](../reference/overview-template.md) |
| `architecture.md` | 触る構造（対象トラック）・Contract変更・設計判断 | [architecture-template.md](../reference/architecture-template.md) |
| `worklog.md` | 時系列の作業ログ + 次に再開するとき最初に読むべきこと | [worklog-template.md](../reference/worklog-template.md) |
| `known-issues.md` | 判明した問題・未解決事項・先送りしたもの | [known-issues-template.md](../reference/known-issues-template.md) |

`overview.md` の冒頭には必ず `> **Issue**: [#<番号> <タイトル>](<Issue URL>)` を記載する。

### 6. 完了報告

作成したファイル一覧と、次のアクション（完成条件の1つ目から着手する等）を提示する。

## 注意事項

- `overview.md` は常にワークスペースのエントリポイントとして簡潔に保つ（詳細は他3ファイルへ委譲）。
- ファイルの生成先は `.claude/workspace/issue-<Issue番号>/` 配下に固定する。
