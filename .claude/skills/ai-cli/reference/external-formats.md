# 外部フォーマット（claude / gemini の出力形式）

このアプリが依存する3つの外部フォーマットの実機観測結果。詳細な実機ログは `docs/PLAN.md` の「2-3 実機で検証した技術的事実」にある（このファイルはその要約 + パース実装との対応）。**すべて公式にサポートされた JSON API ではなく、CLI のバイナリ更新で形が変わりうる前提で扱うこと。**

## `claude agents --json`

実機（Claude Code v2.1.220）で確認した出力は、次のフィールドを持つ JSON 配列。

- `pid`（数値） / `cwd`（文字列） / `kind`（文字列、例 `"interactive"`） / `startedAt`（数値・epoch ms） / `sessionId`（文字列） / `name`（文字列） / `status`（文字列、例 `"busy"`）

- `--cwd <path>` でその作業ディレクトリのセッションだけに絞り込める
- `--all` を付けると終了済みセッションも含めて返る
- **Web 上の二次情報は「バックグラウンド agent しか返さない」と説明しているが、実機では対話セッション（人間が PTY で使っている `claude` 本体）も `kind: "interactive"` として一覧に含まれた。実機の観測を正とし、二次情報を信用しない**

パース実装は `src/main/agents/claude.ts` の `parseAgentsJson` / `toAgentTask`。1要素ずつ `sessionId` が文字列であることだけを必須とし、他フィールドは型が合わなければ `undefined` にする（1要素の失敗を他要素に波及させない設計）。

## `~/.claude/projects/<エンコード済みcwd>/<sessionId>.jsonl`

- ディレクトリ名は**作業ディレクトリの絶対パスの `/` を `-` に単純置換しただけ**（`src/main/history/paths.ts` の `encodeProjectDir`）
- 例: `/Users/yoshinaga/Desktop/job/ai-terminal` → `-Users-yoshinaga-Desktop-job-ai-terminal`
- **この変換は非可逆。** 元のディレクトリ名にハイフンが含まれる場合、変換後の文字列だけでは元のパス区切りと区別できない。逆変換で元パスを復元しようとしてはいけない。cwd 側に同じ変換をかけて「照合」する用途にのみ使う

jsonl は1行1 JSON オブジェクトで、`type` フィールドで種別が分かれる（観測された値: `user` / `assistant` / `ai-title` / `last-prompt` / `file-history-snapshot` 等）。共通フィールドとして `sessionId` / `cwd` / `timestamp` / `gitBranch` / `version` が乗る行が多い。

- `type: "user"` の行では `message.content` が**文字列の場合と、`{type, ...}` の混在配列（`text` / `thinking` / `tool_use` / `tool_result` / `image` 等）の場合の両方が観測されている**。どちらの形でも `text` 部分を取り出せるようにパースする必要がある
- `type: "ai-title"` の行にセッションのタイトル（`aiTitle`）が乗る。**このタイトル生成はセッションの後の方で行われるため、生成前に打ち切られたセッションではタイトルが取れない**

パース実装は `src/main/history/reader.ts` の `extractClaudePreview` / `applyClaudeRow` / `extractUserMessageText`。ファイル全体は読まず、先頭 512KB・最大200行だけを走査し、必要なフィールドが揃い次第打ち切る。行単位で `JSON.parse` に失敗しても読み飛ばすだけで、ファイル全体のプレビュー取得は継続する。

**公式ドキュメントは「この JSONL は内部フォーマットであり、バージョン間で変わりうる。直接パースするスクリプトは壊れる可能性がある」と明記している。** これが `history/reader.ts` を常に防御的に書く根拠であり、CLAUDE.md 鉄則5の裏付け。

## `gemini --list-sessions`

- **JSON ではなくプレーンテキストを返す。** `-o json` を付けても `--list-sessions` の出力形式は変わらない（実機 Gemini CLI v0.37.0 で確認）
- 出力は「セッション無し」を示す固定文言、または `"Available sessions for this project (N):"` の後ろに `"  <index>. <タイトル> (<相対時刻>) [<内部UUID>]"` 形式の行が続く
- `--resume` は Claude の UUID ベースとは異なり、**行頭の index（1始まりの番号）ベース**。行末の `[UUID]` は表示用の内部識別子であり、`--resume` にそのまま渡せる値ではない
- 相対時刻表現（`"5 minutes ago"` 等）から epoch ミリ秒を近似する。正確な時刻は取得できない

パース実装は `src/main/history/reader.ts` の `parseGeminiListSessions` / `GEMINI_LINE_RE` / `approximateEpochFromRelativeTime`。

## 実データでの取得率（328件で計測）

- `title`（`ai-title` 行由来）: 86%
- `firstPrompt`（`type: "user"` の冒頭テキスト由来）: 98.8%

title が取れないセッションは `ai-title` 生成前に終了したものである可能性が高い。UI 側は `title` が無い場合 `firstPrompt` にフォールバックする前提で作られている。
