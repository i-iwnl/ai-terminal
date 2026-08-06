// 生きている tmux セッションの一覧（このアプリが起動したものだけ）。
//
// **何のためにあるか。** タスク一覧は `claude agents --json` が返したセッションを
// 出すが、行を押せるのは**そのセッションを開いているタブがアプリ内にあるとき**だけ
// （`canFocusTaskTab` / `src/renderer/src/App.tsx`）。タブの構成はどこにも永続化して
// いないので、**アプリを再起動した瞬間、走っているセッションは全部「押せない行」になる。**
// 一覧には出ているのに、そこからは戻れない。
//
// tmux でラップして起動したセッションは `aiterm-<agentSessionId>` という名前で
// 生き残っている（`buildTmuxSessionName`）。**名前が分かれば `-A` でアタッチし直せる**ので、
// 「生きているか」さえ分かれば押せる行にできる。それがこのファイルの唯一の仕事。
//
// ⛔ **ここで gemini を起動しないこと。** 会話が0往復の gemini セッションは
// **gemini の起動そのもの**（`--list-sessions` に限らない）で削除される
// （`.claude/workspace/issue-180/known-issues.md` の 12番）。**叩いてよいのは tmux だけ。**
//
// ⛔ **`#{pane_start_command}` などのコマンド文字列をこのモジュールの外へ出さないこと。**
// そこには採番した UUID が生で載る。撮影レーンは「ターミナルに生の UUID を出さない」を
// 決定性の関門として守っている（`e2e/specs/S102-gemini-session-id.spec.ts`）。

import { spawnSync } from 'node:child_process';

/** `buildTmuxSessionName()` が付ける接頭辞。ここだけが剥がす側の正。 */
const SESSION_NAME_PREFIX = 'aiterm-';

/** ハングした tmux に引きずられないためのタイムアウト。 */
const TMUX_TIMEOUT_MS = 3000;

/**
 * `tmux list-sessions -F '#{session_name}'` の出力から、
 * このアプリが起動したセッションの `agentSessionId` を取り出す。
 *
 * **アプリ以外の tmux セッションは落とす。** 利用者が自分で作ったセッションを
 * 「回収できる」と言わないため。**接頭辞だけのもの（ID が空）も落とす。**
 *
 * 純粋関数（入力から出力が閉じている）。tmux を叩く側は下の
 * `listLiveAgentSessionIds()`。
 */
export function parseLiveAgentSessionIds(stdout: string): Set<string> {
  const ids = new Set<string>();
  for (const line of stdout.split('\n')) {
    const name = line.trim();
    if (!name.startsWith(SESSION_NAME_PREFIX)) continue;
    const id = name.slice(SESSION_NAME_PREFIX.length);
    if (id.length === 0) continue;
    ids.add(id);
  }
  return ids;
}

/**
 * いま生きている、このアプリ由来の tmux セッションの `agentSessionId` 集合。
 *
 * 失敗（tmux が無い / サーバが動いていない / タイムアウト）は**空集合**を返す。
 * ⭐ **空集合に倒す向きが重要。** 倒れた先は「押せない行のまま」＝ 今までと同じ挙動で、
 * 「生きていないのに押せる」（押すと新しいプロセスが生える）側には倒れない。
 */
export function listLiveAgentSessionIds(): Set<string> {
  try {
    const result = spawnSync('tmux', ['list-sessions', '-F', '#{session_name}'], {
      encoding: 'utf8',
      timeout: TMUX_TIMEOUT_MS,
    });
    // サーバが動いていなければ status != 0（`no server running on ...`）。それは異常ではない。
    if (result.status !== 0 || !result.stdout) return new Set();
    return parseLiveAgentSessionIds(result.stdout);
  } catch {
    return new Set();
  }
}
