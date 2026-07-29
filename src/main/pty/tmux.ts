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
// - gemini: 安定したセッション ID を持たない（--resume は "latest" や index を
//   受け取るだけで、こちらが ID を採番することも CLI から一意な ID を得ることもできない）。
//   そのため gemini のセッション名は ptyId（起動のたびに使い捨てる UUID）に頼るしかなく、
//   タブを閉じるとその名前を二度と再現できない。サーバ側のセッションと gemini プロセスは
//   残り続けるが、アプリからは名前が分からず、二度と `-A` で当たらない。
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
 * 既存のセッション ID）。gemini には安定した ID が無いため ptyId を渡すしかなく、
 * その場合はタブを閉じると同じ名前を二度と再現できない（拾い直せない）。
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
