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
| `--resume <index>` | 履歴一覧の index で指定したセッションを再開する | Claude の UUID ベースと異なり **index ベース** |

Gemini には実行中タスク一覧に相当するコマンドが確認できておらず、`src/main/agents/gemini.ts` は未対応を返すだけの器になっている。見つかった場合はこのファイルと `gemini.ts` の両方を更新する。

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
