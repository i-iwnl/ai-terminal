// `claude agents --json` が返したタスクと、生きている tmux セッションの突き合わせ。
//
// **なぜ2本目のキーが要るか。** アプリは `claude --session-id <uuid>` で起動し、
// tmux セッション名も `aiterm-<uuid>` にするので、本来は UUID 1本で全部が繋がる。
// ところが **`claude` は CLI 内の `/resume` や `/clear` で自分の sessionId を切り替える。**
// その瞬間、`claude agents --json` が返す `sessionId` はアプリが渡した UUID と別物になり、
// UUID しか見ていない突き合わせが**同時に全部外れる**:
//
// | 壊れるもの | 結果 |
// |---|---|
// | `ownedByApp` | 「このアプリ」の印が消える |
// | `recoverable` | `resolveTaskRowAction` が `'none'` を返し、**押せない行**になる |
// | タブの照合 | **タブを開いている最中ですら**「開いていない」と判定される |
// | 重複排除 | 同じ1本のプロセスが「タブに戻せる AI」にも**別行で二重に**並ぶ |
//
// 実機で観測した形（2026-08-07）:
//
// ```
// pane_pid 60756  tmux 名 aiterm-119a69f7-…   argv: claude --session-id 119a69f7-…
// agents --json:  pid 60756  sessionId 1adde719-…   status idle   ← 別 UUID
// ```
//
// **pid は CLI 側の都合で変わらない**ので、この乖離を跨いで対応が付く。
// tmux の `#{pane_pid}` はペインで直接動いているプロセス = `claude` 本体そのもの
// （実測で確認済み。`tmuxSessions.ts`）。

/** 突き合わせに使うタスク側の情報。`AgentTask` から必要な分だけ受け取る。 */
export interface MatchableTask {
  sessionId: string;
  pid?: number;
}

/** 突き合わせに使う tmux セッション側の情報。`LiveAgentSession` の部分集合。 */
export interface MatchableSession {
  agentSessionId: string;
  panePid?: number;
}

/**
 * 各タスクについて「アプリ側が掴むためのキー」を解決する。
 *
 * 返すのは `task.sessionId` -> `agentSessionId` の対応。**解決できなかったタスクは
 * 入れない**（呼び出し側は `sessionId` にフォールバックする = 従来どおりの挙動）。
 *
 * 解決の順序に意味がある:
 *
 * 1. **UUID が一致するものを先に確定する。** これは直接の証拠で、pid より強い。
 *    先に pid で当ててしまうと、pid が使い回された異常時に**正しく一致している対応を
 *    横取りしうる**
 * 2. 残ったタスクだけを pid で当てる。**1 で使われた tmux セッションは対象から外す**
 *    （1本の tmux セッションを2つのタスクが取り合わない）
 *
 * ⛔ **`pid` / `panePid` が undefined のものを pid 一致に混ぜないこと。**
 * `undefined === undefined` で全部が最初の1本に吸い寄せられる。
 *
 * ⚠ この防御は**タスク側と tmux 側の2箇所にあり、片方だけでも成立する**（冗長）。
 * 片方を外しても単体テストは緑のままなので、**「テストが通るから要らない」と
 * 早合点して消さないこと**。両方外すと `session-match.test.ts` の
 * 「undefined 同士が一致しない」が落ちる（2026-08-07 に実測して確認済み）。
 */
export function resolveAppSessionIds(
  tasks: readonly MatchableTask[],
  liveSessions: readonly MatchableSession[],
): Map<string, string> {
  const resolved = new Map<string, string>();
  const claimed = new Set<string>();

  const liveById = new Map(liveSessions.map((s) => [s.agentSessionId, s]));

  // 1. UUID の直接一致。
  for (const task of tasks) {
    if (!liveById.has(task.sessionId)) continue;
    resolved.set(task.sessionId, task.sessionId);
    claimed.add(task.sessionId);
  }

  // 2. 残りを pid で当てる。
  const livePidIndex = new Map<number, string>();
  for (const session of liveSessions) {
    if (session.panePid === undefined) continue;
    if (claimed.has(session.agentSessionId)) continue;
    // 同じ pid が2本に出るのは異常。先勝ちにして、後から来たほうは捨てる。
    if (livePidIndex.has(session.panePid)) continue;
    livePidIndex.set(session.panePid, session.agentSessionId);
  }

  for (const task of tasks) {
    if (resolved.has(task.sessionId)) continue;
    if (task.pid === undefined) continue;
    const agentSessionId = livePidIndex.get(task.pid);
    if (agentSessionId === undefined) continue;
    if (claimed.has(agentSessionId)) continue;
    resolved.set(task.sessionId, agentSessionId);
    claimed.add(agentSessionId);
  }

  return resolved;
}
