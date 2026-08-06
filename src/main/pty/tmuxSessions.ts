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
 * 生きているセッション1本の要約。
 *
 * ⛔ **`pane_start_command` そのものをここに入れない。** 起動コマンドには採番した UUID が
 * 生で載る。provider の判定にだけ使い、**文字列はこのモジュールの外へ出さない**。
 */
export interface LiveAgentSession {
  /** `aiterm-` を剥がした ID。tmux 名の再現に使う。 */
  agentSessionId: string;
  /** 起動コマンドの先頭から確定した CLI。⭐ 名前から推測していない。 */
  provider: 'claude' | 'gemini';
  /** そのペインの現在のディレクトリ。表示とスコープ判定に使う。 */
  cwd?: string;
}

/**
 * `-F` の区切り。**空白や `|` は使えない**（起動コマンドにも cwd にも入りうる）。
 * 0x1f（UNIT SEPARATOR）は argv にもパスにも実質現れない。
 */
const FIELD_SEPARATOR = '\x1f';

/** tmux に渡す書式。フィールドを増やすときはパース側と必ず一緒に変えること。 */
export const LIVE_SESSION_FORMAT = [
  '#{session_name}',
  '#{pane_start_command}',
  '#{pane_current_path}',
].join(FIELD_SEPARATOR);

/** 起動コマンドの先頭語から CLI を確定する。⭐ セッション名からは推測しない。 */
function providerOf(startCommand: string): LiveAgentSession['provider'] | undefined {
  // 先頭語だけを見る（`claude --session-id …` / `gemini --session-id …`）。
  const head = startCommand.trim().split(/\s+/)[0] ?? '';
  const bin = head.slice(head.lastIndexOf('/') + 1);
  if (bin === 'claude') return 'claude';
  if (bin === 'gemini') return 'gemini';
  return undefined;
}

/**
 * `tmux list-panes -a -F <LIVE_SESSION_FORMAT>` の出力を解釈する。
 *
 * - `aiterm-` で始まらないセッション（利用者が自分で作ったもの）は落とす
 * - **CLI を確定できない行も落とす**（シェルだけの tmux セッション等）。
 *   ⛔ 「たぶん claude」と推測しない
 * - **同じセッションが複数行来る**（利用者が tmux の中で自分でペインを分割した場合）。
 *   **先勝ちで1本に畳む**
 *
 * 純粋関数。tmux を叩く側は `listLiveAgentSessions()`。
 */
export function parseLiveAgentSessions(stdout: string): LiveAgentSession[] {
  const sessions: LiveAgentSession[] = [];
  const seen = new Set<string>();

  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue;
    const [rawName = '', startCommand = '', rawCwd = ''] = line.split(FIELD_SEPARATOR);

    const name = rawName.trim();
    if (!name.startsWith(SESSION_NAME_PREFIX)) continue;
    const agentSessionId = name.slice(SESSION_NAME_PREFIX.length);
    if (agentSessionId.length === 0) continue;
    if (seen.has(agentSessionId)) continue;

    const provider = providerOf(startCommand);
    if (provider === undefined) continue;

    seen.add(agentSessionId);
    const cwd = rawCwd.trim();
    sessions.push({ agentSessionId, provider, cwd: cwd.length > 0 ? cwd : undefined });
  }
  return sessions;
}

/**
 * いま生きている、このアプリ由来のセッション。
 *
 * 失敗（tmux が無い / サーバが動いていない / タイムアウト）は**空**を返す。
 * ⭐ **空に倒す向きが重要。** 倒れた先は「押せない行のまま」＝ 今までと同じ挙動で、
 * 「生きていないのに押せる」（押すと新しいプロセスが生える）側には倒れない。
 */
export function listLiveAgentSessions(): LiveAgentSession[] {
  try {
    const result = spawnSync('tmux', ['list-panes', '-a', '-F', LIVE_SESSION_FORMAT], {
      encoding: 'utf8',
      timeout: TMUX_TIMEOUT_MS,
    });
    // サーバが動いていなければ status != 0（`no server running on ...`）。それは異常ではない。
    if (result.status !== 0 || !result.stdout) return [];
    return parseLiveAgentSessions(result.stdout);
  } catch {
    return [];
  }
}

/**
 * いま生きている、このアプリ由来の tmux セッションの `agentSessionId` 集合。
 *
 * 失敗時は**空集合**（理由は `listLiveAgentSessions()` と同じ）。
 */
export function listLiveAgentSessionIds(): Set<string> {
  try {
    const result = spawnSync('tmux', ['list-sessions', '-F', '#{session_name}'], {
      encoding: 'utf8',
      timeout: TMUX_TIMEOUT_MS,
    });
    if (result.status !== 0 || !result.stdout) return new Set();
    return parseLiveAgentSessionIds(result.stdout);
  } catch {
    return new Set();
  }
}
