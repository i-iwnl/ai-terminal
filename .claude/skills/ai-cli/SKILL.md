---
name: ai-cli
description: Claude Code (claude CLI) と Gemini CLI (gemini CLI) を node-pty の子プロセスとして起動し、その出力（claude agents --json / ~/.claude/projects の JSONL / gemini --list-sessions のテキスト）をパースして実行中タスク一覧・履歴一覧を作る仕組みを扱う。「実行中タスク一覧が表示されない」「サイドバーが空になる」「履歴一覧・resume一覧が出ない」「claude agents --json や JSONL の形式が変わってパースが壊れた」「claude/gemini の起動フラグを増やしたい・変えたい」「--session-id や --resume の挙動を知りたい」といった依頼で読む。PTY 自体の起動・IPC 経路は扱わない（terminal / electron-ipc skill を参照）。
---

# ai-cli: Claude Code / Gemini CLI 連携

このアプリが `claude` / `gemini` を子プロセスとして飼い、その出力から実行中タスク一覧・履歴一覧を作る部分の知識を集約する。外部フォーマットは公式に「壊れうる」と明記されている、このアプリ最大の技術的リスク領域。

## どれを読むか

| やること | 読むドキュメント |
|---|---|
| `claude agents --json` / JSONL / `gemini --list-sessions` の形式を知りたい | [reference/external-formats.md](reference/external-formats.md) |
| このアプリが使っている CLI フラグ・認証方針・検知方式を知りたい | [reference/cli-flags.md](reference/cli-flags.md) |
| CLI を更新したらパースが壊れたので直したい | [operations/fix-broken-parser.md](operations/fix-broken-parser.md) |

## 非推奨 / 絶対に守ること

- 外部フォーマットの知識をこの skill が指す2ファイル（`src/main/agents/claude.ts` / `src/main/history/reader.ts`）の外に漏らさない → 漏らすと CLI 側の仕様変更のたびに直す場所が複数に増える（根拠は CLAUDE.md 鉄則4）
- パース失敗でアプリを落とさない。取得できた情報だけで縮退表示する → CLAUDE.md 鉄則5が唯一の正
- `~/.claude/projects/<encoded>/` のディレクトリ名から元の cwd を逆変換しようとしない → ハイフンを含む元パスとの区別がつかず非可逆（詳細は reference/external-formats.md）

## 関連

- PTY の起動・ライフサイクル管理そのもの → [/terminal](../terminal/SKILL.md)
- IPC チャンネル・contextBridge の設計 → [/electron-ipc](../electron-ipc/SKILL.md)
- アーキテクチャの鉄則・検証コマンドの唯一の正 → ルート CLAUDE.md
