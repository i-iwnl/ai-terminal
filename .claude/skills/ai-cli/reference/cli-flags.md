# このアプリが使う CLI フラグ

`claude` / `gemini` の起動引数はこのアプリの他の場所には散らさず、`src/main/pty/manager.ts`（`buildClaudePlan` / `buildGeminiPlan` / `buildSpawnPlan`）と `src/main/agents/claude.ts`（`listClaudeAgents`）だけが組み立てる。フラグを増減するときはこの2ファイルを起点にする。

## Claude Code

| フラグ | 用途 | 備考 |
|---|---|---|
| `--session-id <uuid>` | 新規セッションを**アプリ側が採番した UUID** で起動する | `buildClaudePlan` が `resumeSessionId` 未指定時に `randomUUID()` で採番。この ID を後から `claude agents --json` の `sessionId` と突き合わせて自分が起動したセッションを判別する（`markOwnedSession`） |
| `--resume <sessionId>` | 既存セッションを再開する | **公式サポート済みの安定インターフェース。** JSONL のプレビューパースが CLI 更新で壊れても、この再開機能自体は影響を受けない |
| `agents --json` | 実行中セッション一覧を取得する | ポーリング対象。形式の詳細は [external-formats.md](external-formats.md) |
| `--cwd <path>` | `agents --json` を作業ディレクトリで絞り込む | アプリの設定 `scopeAgentsToCwd` が有効なときのみ付与する。**設定だけでは足りない**（下の注意を参照） |
| `--all` | `agents --json` に終了済みセッションも含める | 現状の実装では未使用（将来、終了済み一覧を出す場合の拡張余地） |

### ⚠ `--cwd` は「設定が true」だけでは付かない

付与の条件は2つあり、**両方揃わないと絞り込みは効かない**。

1. `config.scopeAgentsToCwd` が true であること
2. `poller.ts` の `lastKnownCwd` に値が入っていること

2つ目が落とし穴。`lastKnownCwd` は **Renderer が `agents:list` に `cwd` を添えて呼んだときにしか更新されない**。実際に `TaskList.tsx` が `list({})` と空で呼んでおり、設定を true にしても一度も効いていなかった（S34 / S35 で塞いだ）。

現在は初期値として Main の `process.cwd()` を入れてあるので、Renderer が渡さなくても既定では動く。ただし**将来「ユーザーが cd した先を追跡する」を実装したときは、Renderer から渡す経路が唯一の正になる**（`src/renderer/src/lib/cwd.ts` が共有 cwd の単一の管理場所）。Renderer 側を消してよいコードだと判断しないこと。

`--cwd` の実機での挙動は [external-formats.md](external-formats.md) を参照（help の文言に反して interactive なセッションにも効く）。

## Gemini CLI

| フラグ | 用途 | 備考 |
|---|---|---|
| `--list-sessions` | 履歴一覧を取得する | 出力はテキスト（`-o json` を付けても変わらない）。詳細は [external-formats.md](external-formats.md) |
| `--resume <index>` | 履歴一覧の index で指定したセッションを再開する | Claude の UUID ベースと異なり **index ベース**。⛔ **UUID を渡さない**（下記） |
| `--session-id <uuid>` | 新規セッションを指定した UUID で起動する | **存在する**（0.53.0 で確認）。渡した UUID はそのまま `--list-sessions` 行末の `[UUID]` に出る。**アプリではまだ使っていない**（[#155](https://github.com/i-iwnl/ai-terminal/issues/155)） |
| `-i, --prompt-interactive <prompt>` | プロンプトを実行してから対話モードに留まる | **測定用に効く。** 対話モードの gemini に外から入力を届けるのは難しい（後述）ので、会話済みのセッションを確実に作るにはこれを使う |

Gemini には実行中タスク一覧に相当するコマンドが確認できておらず、`src/main/agents/gemini.ts` は未対応を返すだけの器になっている。見つかった場合はこのファイルと `gemini.ts` の両方を更新する。

### 2026-08-06 実測（Gemini CLI 0.53.0）

Issue #155 は「`--session-id` が使えるようになったので claude と対称にできる」と主張していた。**主張は正しい。**

| 測ったこと | 結果 |
|---|---|
| `--session-id <UUID>` で起動 | 渡した UUID がそのまま `--list-sessions` 行末の `[UUID]` に出る（`GEMINI_LINE_RE` がそのまま拾える）。ファイル名も `session-<日時>-<UUID先頭8>.jsonl` |
| 既存 UUID を `--session-id` に渡す | `Session ID "…" already exists. Use --resume` で**起動しない**（resume 経路では渡せない） |
| ⛔ `--resume <UUID>` | **使ってはいけない。** 英字始まりの UUID は偶然動くが、**数字始まり（全体の約 62%）は index として解釈され、別セッションを作ったうえで既存のセッションファイルを失う**（2回再現）。resume の引数は index のままにし、UUID は tmux セッション名にだけ使う |
| 走行中のセッションは `--list-sessions` に出るか | ✅ **出る**（会話が1往復以上あれば。走行中でも消えない） |
| ⚠ **実質空のセッション**（初期コンテキストだけ / 会話0往復） | **一覧に出ず、gemini を起動すると削除される。** `--list-sessions` 固有ではなく**起動全般**の挙動（`-p` の通常起動でも同じ）。詳細は `.claude/workspace/issue-180/known-issues.md` の 12番 |

### ⛔ gemini の対話挙動を測るときの罠（2026-08-06 に4回踏んだ）

- **`pty` 経由でテキストを書いても Enter が届かない。** `\r` でも `\n` でも、テキストと同じ write に混ぜても、別の write に分けても送信されなかった。**入力欄に文字は乗る**ので画面を見ないと気づけない
- したがって**「会話済みの走行中セッション」を作るには `-i <prompt>` を使う。** これを知らずに「会話済みのつもりの空セッション」で2回測り、**同じ誤った結論を2回再現してしまった**（#155 を一度は「実装しない」で閉じ、再オープンした）
- `script -q /dev/null gemini … < fifo` は使えない（`tcgetattr/ioctl: Operation not supported on socket`）。`python3` の `pty.fork()` + `TIOCSWINSZ`（サイズを与えないと TUI の入力欄が出ない）
- プローブは `~/.gemini/tmp/<cwd の basename>/` に残る。**後片付けする**
- ⭐ **セッション置き場は `basename(cwd)` のディレクトリで、中の `.project_root` にフルパスが書いてある**（ハッシュを推測しなくても引ける）

## 認証方針

API キーを使わず CLI のサブスクリプション認証をそのまま使う。根拠・詳細はルート CLAUDE.md「AI CLI との連携方針」を参照（ここでは重複させない）。

## 実行中タスクの検知手段: なぜポーリングを採ったか

実行中タスクを検知する手段として、次の3つを比較した。

| 手段 | 採否 | 理由 |
|---|---|---|
| Claude Code の Hooks（UserPromptSubmit / PreToolUse / Stop 等） | 見送り | HTTP エンドポイントを立てて待ち受ける構成が必要になり、実装コストに対して MVP で得られる精度差が小さい |
| 子プロセスの生死をプロセス監視で追う | 見送り | `tmux` でラップした場合、内側の `claude` が終了しても外側の tmux セッションは残るため、プロセス監視だけでは完了を検知できない（`docs/PLAN.md` 9章の既知の注意点） |
| `claude agents --json` の定期ポーリング | **採用** | 実機で対話セッションも含めて返ることを確認済み（[external-formats.md](external-formats.md)）。実装が単純で、tmux ラップの有無に関係なく `status` を直接見られる |

ポーリングの実装は `src/main/agents/poller.ts`。前回の取得完了後に次回をスケジュールする再帰的な `setTimeout` で、間隔は設定の `pollIntervalMs` に従う。
