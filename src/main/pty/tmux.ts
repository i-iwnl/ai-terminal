// tmux 永続化まわりのロジック（存在確認 / コマンドのラップ）。
//
// アプリを再起動しても Claude / Gemini のセッションが生き残るよう、
// `tmux new-session -A -s <name> -- <command> ...` でラップして起動する。
// `-A` は同名セッションが既にあればアタッチ、無ければ新規作成になるため、
// 呼び出し側が毎回同じ名前を渡せさえすれば、アプリ再起動後も作業を拾い直せる。
//
// ⭐ **このコメントが「claude / gemini の非対称」の唯一の正。** 他の場所（closeTabCopy.ts /
// pty-plan.test.ts / S90 の spec）は、ここへの参照1行に留めること。**同じ説明を書き写すと、
// 片方だけ古くなって「どちらが正か分からない」状態になる**（実際に一度そうなった）。
//
// 「毎回同じ名前を渡せるか」の担保は CLI ごとに違う:
// - claude: buildClaudePlan が agentSessionId を返す。新規起動なら --session-id で
//   自前採番した UUID、resume なら --resume に渡した既存のセッション ID がそのまま
//   入るため、同じ claude セッションに対しては常に同じ tmux セッション名になる。
//   これにより、Cmd+W でタブを閉じてタブ管理から見失っても、履歴から resume すれば
//   同じ tmux セッション（＝生きたままの claude プロセス）に `-A` でアタッチし直せる。
// - gemini: **claude と同じ形にした**（Issue #155 / 2026-08-06 実測。Gemini CLI 0.53.0）。
//   新規は `--session-id` で自前採番、resume は履歴側の内部 UUID（`--list-sessions` 行末の
//   `[UUID]` = `SessionHistoryEntry.stableId`）を agentSessionId に入れる。
//   `--resume <index>` で再開しても、そのセッションの UUID は変わらないことを実測済み。
//
//   ⛔ **`--resume` に UUID を渡してはいけない。** `--resume` は index を受け取る
//   インターフェースで、**数字始まりの UUID（全体の約 62%）は index として解釈され、
//   別セッションを作ったうえで既存のセッションファイルを失う**（同日実測 / 2回再現）。
//   UUID は tmux セッション名にだけ使う。
//
//   ⚠ **gemini では agentSessionId が undefined になることがある**（= 従来どおり拾い直せない）:
//     (1) CLI が 0.53.0 未満で `--session-id` を渡せない（src/main/pty/geminiVersion.ts）
//     (2) resume 元の履歴から UUID を取れなかった
//     (3) ⭐ **会話が0往復のセッション。** UUID は採番されるが `--list-sessions` に出ないので、
//         閉じたあと履歴から選べない。しかも次に gemini を起動した時点でセッションファイルごと
//         消える（`.claude/workspace/issue-180/known-issues.md` の 12番）。
//         **(3) だけは agentSessionId が埋まっているのに戻れない**ので、Renderer 側の
//         「回収できる」判定からは見えない。README のトラブルシューティングに書いてある。
//
// tmux が存在しない環境では必ず素の起動にフォールバックできることが前提（tmux 必須にしない）。

import { spawnSync } from 'node:child_process';

/** 起動するコマンドと引数の組。 */
export interface CommandSpec {
  command: string;
  args: string[];
}

let tmuxAvailableCache: boolean | undefined;

/**
 * tmux が PATH 上に存在するかどうか。
 * `which tmux` 相当の同期チェックを1回だけ行い、以後は結果をキャッシュする
 * （spawn のたびに存在確認をやり直すのはコストなので避ける）。
 */
export function isTmuxAvailable(): boolean {
  if (tmuxAvailableCache !== undefined) return tmuxAvailableCache;
  try {
    const result = spawnSync('which', ['tmux'], { stdio: 'ignore' });
    tmuxAvailableCache = result.error === undefined && result.status === 0;
  } catch {
    tmuxAvailableCache = false;
  }
  return tmuxAvailableCache;
}

/**
 * tmux セッション名を組み立てる。
 * 呼び出し側は「その CLI セッションに対して常に同じ値になる」安定したキーを渡すこと
 * （単に一意なだけでは、起動のたびに変わってしまい `-A` が既存セッションに当たらない）。
 * claude / gemini とも agentSessionId（--session-id で採番した UUID、または既存の
 * セッション ID）。agentSessionId が無いときだけ ptyId に落ち、その場合は
 * タブを閉じると同じ名前を二度と再現できない（拾い直せない）。
 * 落ちる条件は冒頭のコメントが唯一の正。
 */
export function buildTmuxSessionName(idPart: string): string {
  return `aiterm-${idPart}`;
}

/**
 * tmux セッションへ持ち込まない環境変数。
 *
 * - `TMUX` / `TMUX_PANE`: 入れ子の tmux だと誤認させる。アプリ自身が tmux の
 *   内側で起動されている場合に混入する。
 * - `_`: 直前に実行したコマンドのパスで、意味が無いうえ毎回変わる。
 */
const TMUX_ENV_DENYLIST: readonly string[] = ['TMUX', 'TMUX_PANE', '_'];

/**
 * 環境変数を `/usr/bin/env K=V ...` の引数列に変換する。
 *
 * `undefined` の値は「設定しない」を意味するので落とす。`=` を含むキーは
 * `env` が解釈できない形になるため落とす（外部から来た値で argv を壊さない）。
 */
export function buildTmuxEnvArgs(env: Record<string, string | undefined>): string[] {
  const args: string[] = [];
  for (const key of Object.keys(env).sort()) {
    const value = env[key];
    if (value === undefined) continue;
    if (key === '' || key.includes('=')) continue;
    if (TMUX_ENV_DENYLIST.includes(key)) continue;
    args.push(`${key}=${value}`);
  }
  return args;
}

/**
 * コマンドを `tmux new-session -A -s <name> -- /usr/bin/env K=V ... <command> ...` でラップする。
 * 副作用の無い純粋関数。tmux が使えるかどうかの判断は呼び出し側（isTmuxAvailable）に委ねる。
 *
 * ⭐ **なぜ env を引数として渡すのか。** `tmux new-session` に渡した環境変数は
 * **子プロセスに届かない**。tmux はサーバ・クライアント型で、セッションの中で走る
 * プロセスが継ぐのは**サーバ起動時に凍結された env** だからで、クライアント側の env から
 * 引き継がれるのは `update-environment`（既定で DISPLAY / SSH_* など13個）に
 * 挙がっているものだけ。**`buildPtyEnv` が組み立てた値は1つも届いていなかった。**
 *
 * 実害（2026-08-06 実測 / tmux 3.7b・Gemini CLI 0.54.0・実アプリを agent-browser で観測）:
 * `~/.zshrc` で定義された `GOOGLE_CLOUD_PROJECT` が届かず、Gemini タブが
 * `IneligibleTierError: This client is no longer supported for Gemini Code Assist for
 * individuals` で**認証できなかった**。設定「アプリを閉じても AI の作業を続ける」を
 * 切る（= tmux ラップをやめる）と同じアプリ・同じ env で `Signed in with Google` になる、
 * という非対称で切り分けた。
 *
 * ⛔ **`tmux new-session -e K=V` は使わない。** tmux 3.2 以降にしか無いうえ、
 * **`-A` で既存セッションに当たったときは無視される**（実測: 2回目の `-e` を
 * 反映せず1回目の値が残る）。`/usr/bin/env` でラップすれば版に依存せず、
 * `-A` の意味（既存があればアタッチ、そのときコマンド自体が無視される）とも整合する。
 */
export function wrapCommandWithTmux(
  sessionName: string,
  spec: CommandSpec,
  env: Record<string, string | undefined> = {},
): CommandSpec {
  return {
    command: 'tmux',
    args: [
      'new-session',
      '-A',
      '-s',
      sessionName,
      '--',
      '/usr/bin/env',
      ...buildTmuxEnvArgs(env),
      spec.command,
      ...spec.args,
    ],
  };
}
