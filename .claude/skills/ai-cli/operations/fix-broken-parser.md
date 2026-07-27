# CLI 更新でパースが壊れたときに直す

`claude` / `gemini` のバイナリを更新した後、実行中タスク一覧が空になる・履歴のタイトルや冒頭プロンプトが取れなくなる、といった症状が出たときの調査・修正手順。CLAUDE.md 鉄則4により、直す場所は必ず次のどちらか1ファイルに閉じる。

- `claude agents --json` の出力形式 → `src/main/agents/claude.ts`
- `~/.claude/projects/*.jsonl` / `gemini --list-sessions` の出力形式 → `src/main/history/reader.ts`

## 手順

### 1. 実際にコマンドを叩いて生の出力を確認する

症状に応じて、疑わしい方を直接叩く。

```bash
claude agents --json
claude agents --json --cwd "$(pwd)"

# 対象セッションの jsonl を直接見る（先頭数行で十分）
head -n 20 ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl

gemini --list-sessions
```

**セッション本文（プロンプトやコード片）を Issue やコミットメッセージに転記しない。** フィールド構造（キー名・型）だけを記録する。

- 終了条件: 実際に出力された JSON / テキストの生の形を手元に持っている状態になっている

### 2. どのフィールドが変わったか特定する

[reference/external-formats.md](../reference/external-formats.md) に記載した「実機で確認済みの形」と、手順1で得た生の出力を見比べる。フィールド名が変わった・型が変わった・新しい `type` の行が増えた、のどれに当たるかを特定する。

- 終了条件: 「何が」「どう」変わったかを一文で言える状態になっている

### 3. 該当ファイルのパース関数だけを直す

- `claude agents --json` が原因なら `src/main/agents/claude.ts` の `toAgentTask`（1要素の変換）または `parseAgentsJson`（配列全体の検証）だけを直す
- JSONL が原因なら `src/main/history/reader.ts` の `applyClaudeRow` / `extractUserMessageText` だけを直す
- `gemini --list-sessions` が原因なら同ファイルの `GEMINI_LINE_RE` / `parseGeminiListSessions` だけを直す
- 呼び出し側（`poller.ts` や IPC ハンドラ）や型定義（`src/shared/ipc.ts`）にまで手を広げる場合は、外部フォーマットの知識ではなく内部の型・IPC 契約の変更なので、この skill の範囲を超える。慎重に判断する

直したら [reference/external-formats.md](../reference/external-formats.md) の該当箇所も実機の最新観測に更新する（コードと知識ドキュメントを同時に合わせる）。

- 終了条件: 手順1で得た生の出力を、修正後の関数にそのまま通して期待した `AgentTask` / `SessionHistoryEntry` が得られる

### 4. 縮退表示が機能するか確認する

意図的に壊れた入力（空文字列・想定外の JSON・型違いのフィールド）を関数に通し、例外を投げずに縮退した結果を返すことを確認する。履歴側なら `sessionId` と `updatedAt`（mtime）だけの `SessionHistoryEntry` が返ること、タスク一覧側なら `error` 付きの空配列が返ることを確認する。

- 終了条件: 壊れた入力を渡してもアプリ（Main プロセス）が例外で落ちない

## 絶対に守ること

パース失敗でアプリを落とさない。取得できた情報だけで縮退表示する（履歴なら `sessionId` と `mtime` だけで一覧に出す）。この方針自体の根拠は CLAUDE.md 鉄則5であり、ここで再定義はしない。

## DoD（完了条件）

- 手順1〜4をすべて終えている
- `npm run typecheck` / `npm run lint` が通る（コマンドの唯一の正はルート CLAUDE.md）
- 意図的な異常入力でアプリが落ちないことを確認済み
- 全部 green になるまで完了扱いにしない
