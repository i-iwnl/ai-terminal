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
 * tmux に「クライアントから引き継げ」と伝える変数名の一覧を作る。
 *
 * ⛔ **返すのは名前だけ。値は絶対に含めない。** 値を argv に載せると
 * `ps` から誰にでも読める（下の `buildTmuxUpdateEnvironment` のコメント参照）。
 *
 * `undefined` の値は「設定しない」を意味するので落とす。`=` や空白を含むキーは
 * tmux のオプション値（空白区切り）を壊すので落とす。
 */
export function buildTmuxEnvNames(env: Record<string, string | undefined>): string[] {
  const names: string[] = [];
  for (const key of Object.keys(env).sort()) {
    if (env[key] === undefined) continue;
    if (key === '' || /[\s=]/.test(key)) continue;
    if (TMUX_ENV_DENYLIST.includes(key)) continue;
    names.push(key);
  }
  return names;
}

/**
 * `update-environment` に設定する値（空白区切りの変数名の並び）を組み立てる。
 *
 * ⭐ **なぜ値ではなく名前を渡すのか。** tmux はサーバ・クライアント型で、
 * セッションの中で走るプロセスが継ぐのは**サーバ起動時に凍結された env**。
 * クライアント側から引き継がれるのは `update-environment` に挙がっている名前だけで、
 * **値は node-pty がクライアントへ渡した env から tmux が読む**。
 * つまり値は一度も argv を通らない。
 *
 * ⛔ **以前は `-- /usr/bin/env K=V ... <command>` でラップしていたが、これは
 * 秘密を漏らす（2026-08-06 実測）。** `env` は exec するので env 自身の argv は
 * 消えるが、**node-pty が起動した tmux クライアントはタブが開いている間ずっと生き、
 * その argv に全ての値が残る**。`ps -eo command` で同じマシンの誰からでも読めた:
 *
 * ```
 * tmux new-session -A -s probeSec3 -- /usr/bin/env SECRET_TOKEN=hunter3xyz ... sleep 60
 * ```
 *
 * ⚠ **利用者の rc に書かれた API キー等がそのまま載る。** 周11 でこの形を入れて
 * しまい、同じ周の中で気づいて差し替えた。
 *
 * ⛔ **`tmux new-session -e K=V` も同じ理由で使えない**（値が argv に載る。加えて
 * tmux 3.2 以降にしか無く、`-A` で既存セッションに当たると無視されることも実測済み）。
 *
 * 既存の値は消さずに温存する。利用者が自分で設定している場合があり、こちらの都合で
 * 上書きしてよいものではない。
 */
export function buildTmuxUpdateEnvironment(
  existing: readonly string[],
  names: readonly string[],
): string {
  const merged: string[] = [];
  for (const name of [...existing, ...names]) {
    const trimmed = name.trim();
    if (trimmed.length > 0 && !merged.includes(trimmed)) merged.push(trimmed);
  }
  return merged.join(' ');
}

/**
 * コマンドを `tmux new-session -A -s <name> -- <command> ...` でラップする。
 * 副作用の無い純粋関数。tmux が使えるかどうかの判断は呼び出し側（isTmuxAvailable）に委ねる。
 *
 * ⚠ **環境変数はここに載せない。** tmux は node-pty が渡した env を子プロセスへ
 * 引き継がないが、その解決は `update-environment`（`buildTmuxUpdateEnvironment` /
 * `ensureTmuxUpdateEnvironment`）で行う。**値を argv に載せると `ps` から読める**ので、
 * ここは名前も値も持たない（理由の全文は `buildTmuxUpdateEnvironment` のコメント）。
 */
export function wrapCommandWithTmux(sessionName: string, spec: CommandSpec): CommandSpec {
  return {
    command: 'tmux',
    args: ['new-session', '-A', '-s', sessionName, '--', spec.command, ...spec.args],
  };
}

/**
 * 生きている tmux セッションへ**アタッチするだけ**のコマンドを組み立てる。
 *
 * ⛔ **`new-session -A` を使わないこと。** `-A` は「無ければ作る」なので、
 * **一覧に出してから押すまでの間にセッションが死んでいると `--` 以降を実行する**。
 * そこに `gemini --resume <UUID>` のような引数が載っていると、
 * **数字始まりの UUID が index として解釈され、既存のセッションファイルを失う**
 * （冒頭のコメント参照）。`attach-session` なら**存在しなければ失敗して終わるだけ**で、
 * 「消えていた」を「新しいセッションを作って上書き」に化けさせない。
 *
 * design-review（2026-08-06 / 5ペルソナ）で3人が独立に指摘した経路。
 */
export function buildTmuxAttachCommand(sessionName: string): CommandSpec {
  return { command: 'tmux', args: ['attach-session', '-t', sessionName] };
}

let updateEnvironmentApplied = false;

/**
 * tmux サーバの `update-environment` に、アプリが渡したい変数名を追記する。
 *
 * これを呼んでおくと、以後 `new-session` で作る（または `-A` でアタッチする）
 * セッションに、**node-pty がクライアントへ渡した env の値**が引き継がれる。
 * 値は argv を通らないので `ps` から見えない。
 *
 * 起動のたびに呼ぶのは無駄なので1度だけ実行する（`isTmuxAvailable()` と同じ形）。
 * 失敗しても例外を投げない。**env が届かないだけで、タブは従来どおり開く**。
 */
export function ensureTmuxUpdateEnvironment(env: Record<string, string | undefined>): void {
  if (updateEnvironmentApplied) return;
  updateEnvironmentApplied = true;
  try {
    const shown = spawnSync('tmux', ['show-options', '-gv', 'update-environment'], {
      encoding: 'utf8',
    });
    // 取れなければ空から始める（既存を消すわけではなく、tmux 既定のまま追記できないだけ）。
    const existing =
      shown.status === 0 && shown.stdout ? shown.stdout.split('\n').filter((l) => l.trim()) : [];
    const value = buildTmuxUpdateEnvironment(existing, buildTmuxEnvNames(env));
    spawnSync('tmux', ['set-option', '-g', 'update-environment', value], { stdio: 'ignore' });
  } catch {
    // env が届かないだけで済ませる。ここでアプリを止めない。
  }
}

/** テスト用に「1度だけ」の状態を捨てる。 */
export function resetTmuxUpdateEnvironmentForTest(): void {
  updateEnvironmentApplied = false;
}
