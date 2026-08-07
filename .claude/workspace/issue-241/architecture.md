# Architecture

Issue #241 における変更対象の構造。
設計判断の根拠は末尾の「設計判断履歴」を参照。

---

## 1. 対象トラック

単一トラック（main の agents / notify と、shared の状態判定）。Renderer は `agent-status.ts` の
表示ラベル経由でしか影響を受けない。

| コンポーネント | 変更内容 | 影響範囲 |
|---|---|---|
| `src/main/agents/completionNotice.ts`（新設） | 追加 | 完了通知の発火判定を純粋関数として持つ。`poller.ts` だけが呼ぶ |
| `src/main/agents/poller.ts` | 変更 | `detectAndNotifyCompletions` の判定部を上へ委譲し、副作用（notify / dock.bounce / previousTasks 更新）だけを残す |
| `src/main/agents/yourTurnSince.ts` | 変更 | 重複 `sessionId` で set と delete が打ち消し合う問題を同じキー設計で直す |
| `src/main/agents/claude.ts` | 変更（周2） | `waitingFor` をパースに追加する |
| `src/shared/agent-status.ts` | 変更（周2） | `waiting` を `TaskState` の意味へ取り込む |
| `src/shared/ipc.ts` | 変更（周2） | `AgentTask.waitingFor` を追加する（Contract） |

---

## 2. Contract（src/shared/ipc.ts）変更

周1では**なし**。周2で以下を追加する。

| チャンネル / 型 | 変更 | 内容 |
|---|---|---|
| `AgentTask` | ADD | `waitingFor?: string`（`claude agents --json` が `status: "waiting"` に添えて返す理由。例: `"permission prompt"`） |

---

## 3. 技術的制約・前提条件

- ルート CLAUDE.md 鉄則4: `claude agents --json` の出力形式に関する知識は `src/main/agents/claude.ts` の中だけに置く。
  `waitingFor` のパースもそこへ閉じ込め、`poller.ts` は `AgentTask` しか見ない。
- ルート CLAUDE.md 鉄則5: パースは防御的に書く。`waiting` を知ったあとも、**未知の値を既知の値へ丸めない**
  （`toTaskState` の既存コメントが唯一の正）。
- 状態の意味の単一の正は `src/shared/agent-status.ts`。表示（TaskList）・通知（poller）・Dock バッジの
  3箇所が同じ判定を使う。`waiting` の扱いを1箇所で変えない。
- `sessionMatch.ts` の既存の結論を再利用する: **pid は CLI 側の `/resume` を跨いで変わらない**。
  UUID は変わりうる。よって「同じ1本のプロセス」を指すキーとしては pid のほうが強い。

---

## 4. 設計判断履歴

| 日付 | 判断 | 根拠 | 代替案 |
|---|---|---|---|
| 2026-08-07 | 前回・今回の突き合わせキーを `pid ?? sessionId` の複合キーにする | `sessionMatch.ts` が既に「pid は CLI 側の都合で変わらない」と実測で結論づけている。重複 `sessionId` は `/resume` で恒常的に起きうる（#239 と同じ現象） | (a) 重複を捨てて先頭だけ残す -> 生きているプロセスの片方が一覧から消える。(b) sessionId + status で畳む -> status が変わった瞬間に別物と見なされ、遷移そのものを検知できなくなる |
| 2026-08-07 | 判定を `completionNotice.ts` へ純粋関数として切り出す | `computeYourTurnSince` と同じ理由。`poller.ts` の中にあるままではテストが一度も実行できず、実際にこの不具合を素通しした。リポジトリに前例が11ある既定の作法 | `poller.ts` を export して直接叩く -> Electron の `app` / `Notification` に依存するので vitest から読めない |
