// tmux 永続化まわりのロジック（存在確認 / コマンドのラップ）。
//
// アプリを再起動しても Claude / Gemini のセッションが生き残るよう、
// `tmux new-session -A -s <name> -- <command> ...` でラップして起動する。
// `-A` は同名セッションが既にあればアタッチ、無ければ新規作成になるため、
// 呼び出し側が毎回同じ名前を渡せさえすれば、アプリ再起動後も作業を拾い直せる。
//
// ただし「毎回同じ名前を渡せるか」は CLI ごとに非対称で、いまは claude だけが拾い直せる:
// - claude: buildClaudePlan が agentSessionId を返す。新規起動なら --session-id で
//   自前採番した UUID、resume なら --resume に渡した既存のセッション ID がそのまま
//   入るため、同じ claude セッションに対しては常に同じ tmux セッション名になる。
//   これにより、Cmd+W でタブを閉じてタブ管理から見失っても、履歴から resume すれば
//   同じ tmux セッション（＝生きたままの claude プロセス）に `-A` でアタッチし直せる。
// - gemini: **いまは拾い直せないが、それは実装していないだけで CLI 側の制約ではない**
//   （Issue #155 / 2026-08-06 実測。Gemini CLI 0.53.0）。
//   `--session-id <UUID>` は存在し、渡した UUID はそのまま `--list-sessions` 行末の [UUID] に
//   出る。会話が1往復以上あるセッションは**走行中でも**一覧に正しく出るので、claude と同じ形
//   （新規は --session-id で採番 / resume は履歴側の stableId を agentSessionId に入れる）に
//   できる見込みがある。**未実装なので、いまは ptyId に頼っており拾い直せない。**
//   ⛔ ただし `--resume` に UUID を渡してはいけない。**数字始まりの UUID（全体の約 62%）は
//   index として解釈され、別セッションを作ったうえで既存のセッションファイルを失う**（同日実測）。
//   resume の引数は index のままにし、UUID は tmux セッション名にだけ使うこと。
//   ⚠ 別件で、**実質空のセッション（初期コンテキストだけで会話が0往復）は、gemini を
//   もう1つ起動しただけで削除される**（`--list-sessions` に限らず起動全般）。
//   詳細は `.claude/workspace/issue-180/known-issues.md` の 12番。
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
 * claude なら agentSessionId（--session-id で採番した UUID、または --resume に渡した
 * 既存のセッション ID）。gemini は**まだ採番していない**ので ptyId を渡すしかなく、
 * その場合はタブを閉じると同じ名前を二度と再現できない（拾い直せない）。
 * **CLI 側の制約ではなく未実装**。経緯は冒頭のコメントが唯一の正。
 */
export function buildTmuxSessionName(idPart: string): string {
  return `aiterm-${idPart}`;
}

/**
 * コマンドを `tmux new-session -A -s <name> -- <command> ...` でラップする。
 * 副作用の無い純粋関数。tmux が使えるかどうかの判断は呼び出し側（isTmuxAvailable）に委ねる。
 */
export function wrapCommandWithTmux(sessionName: string, spec: CommandSpec): CommandSpec {
  return {
    command: 'tmux',
    args: ['new-session', '-A', '-s', sessionName, '--', spec.command, ...spec.args],
  };
}
