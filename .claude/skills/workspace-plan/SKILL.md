---
name: workspace-plan
description: ai-terminal（Electron製ターミナルアプリ）のワークスペース管理。`.claude/workspace/issue-<Issue番号>/` に overview / worklog / architecture / known-issues の4ファイルを作成・更新し、GitHub Issueと1:1対応させながらセッションをまたいで設計判断・進捗・教訓を保持する。新規ワークスペース作成(init)、進捗の追記とIssueへの同期(update)、ワークスペース一覧とIssueのopen/closed突合(status)を扱う。「作業前にワークスペースを作りたい」「進捗を記録したい」「セッションが切れたので再開したい」「ワークスペースが残っているのにIssueが閉じていないか確認したい」といった依頼で使う。設計->実装->レビュー->PRの一気通貫指揮や複数トラックの並列実装は個人skillの/orchestratorが担う（本skillは重複させない）。チケット管理はGitHub Issuesが正で、リポジトリ内チケットskill(/ticket)は持たない。
---

# workspace-plan

Issue単位でワークスペースドキュメントを作成・維持し、AIセッションが切れてもコンテキストを復元できるようにするための外部記憶skill。

## どれを読むか

| やること | 読むドキュメント |
|---|---|
| Issue番号からワークスペースを新規作成する | [operations/init.md](operations/init.md) |
| 進捗を追記し、節目でIssueに同期する | [operations/update.md](operations/update.md) |
| ワークスペース一覧とIssueの状態を確認する（セッション再開時はここから） | [operations/status.md](operations/status.md) |
| 各ファイルの雛形を確認する | [reference/](reference/) 配下（`overview-template.md` / `worklog-template.md` / `architecture-template.md` / `known-issues-template.md`） |

## ワークスペースの構成

`.claude/workspace/issue-<Issue番号>/` を主キーとし、Issueと1:1で対応させる（ブランチとは1:1にしない）。既定は単一トラック。規模が大きいタスクのみ `main`（Main プロセス: PTY / agents / history）と `renderer`（React UI）の2トラックに分けて `architecture.md` に記録する。

## この skill が持たないもの（意図的な最小構成）

- **orchestrate / implement / parent-child 相当の指揮手順**: 単発タスクの指揮は個人skill `/orchestrator` が既に担っており重複させない。
- **`.claude/agents/*.md` のサブエージェント定義**: 同上。
- **`scripts/lint-skill.sh`**: 構造検査は既存の `bash .claude/scripts/lint-skills.sh` が唯一の正。
- **リポジトリ内チケット管理（`/ticket`）**: チケットの唯一の正はGitHub Issues。

フル構成（orchestrate・サブエージェント・レビュー収束ループ等）が必要になったら `/setup-workspace-skills upgrade` で拡張する。

## 絶対に守ること

- Issue本文を丸ごと `overview.md` にコピーしない（何を・なぜやるかの唯一の正はIssue）。
- `gh issue create` / `gh issue close` など状態を変えるコマンドはこのskillの操作対象外（`gh issue comment` での書き戻しのみ行う）。
- 検証コマンド（typecheck/lint/build）は再掲しない。唯一の正はルート [CLAUDE.md](../../../CLAUDE.md)。

## 関連

- IPCチャンネルの追加・変更 -> [/electron-ipc](../electron-ipc/SKILL.md)
- claude / gemini CLIの起動引数・ポーリング -> [/ai-cli](../ai-cli/SKILL.md)
- PTY・xterm.jsまわり -> [/terminal](../terminal/SKILL.md)
- skill一覧と設計ルールの全体像 -> [.claude/README.md](../../README.md)
