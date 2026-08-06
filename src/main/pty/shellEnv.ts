// ログインシェルの環境変数を1度だけ解決して、PTY へ渡す env に混ぜる。
//
// **なぜ要るか。** macOS の GUI アプリは launchd から起動されるので、
// `~/.zshrc` で `export` した変数を**1つも持っていない**。ターミナルから
// `make dev` で起動したときだけ親シェルの env が継承されるため、
// **「開発中は動くのに、.app にすると動かない」という形で出る。**
//
// 実害（2026-08-06 実測 / #180 周11）: `~/.zshrc` の `GOOGLE_CLOUD_PROJECT` が
// 無いと Gemini CLI が `IneligibleTierError` で認証できず、Gemini タブが
// 「認証方法を選べ」の画面で止まる。**PATH を最小構成にして起動しても
// `claude` / `gemini` / `tmux` は見つかった**ので、実測できているのは
// 「rc で export した変数が欠ける」ところまで。PATH については何も主張しない
// （⛔ 一度ここに「最小 PATH で CLI が見つからない」と書いたが、測っていなかった）。
//
// **シェルペインは影響を受けていなかった**（`buildShellPlan` がログインシェルを
// 起動するので、シェル自身が rc を読み直す）。素で spawn される AI ペインだけが
// 取り残されていた、という非対称がこの実装の理由。
//
// ⚠ **`-l` だけでは足りない。** `GOOGLE_CLOUD_PROJECT` のような `~/.zshrc` の
// 変数は**対話シェルしか読まない**。実測（tmux の中 = 親 env に値が無い条件）:
//
// | 起動 | 結果 |
// |---|---|
// | `zsh -c` | unset |
// | `zsh -l -c` | **unset**（.zshrc は読まれない） |
// | `zsh -i -c` | **set** |
//
// ⛔ **親の env を持ったまま測ると必ず「取れた」と出る。** 最初にこれで
// 誤った結論を出した。`env -i` で親を切ってから測ること。

/**
 * `env -0` の出力の開始位置を示す目印。
 *
 * 対話シェルは rc の中で何かを表示することがあり、そのままだと最初のレコードに
 * 混ざる。**目印より前を捨てる**ことで、rc が何を出しても解釈が壊れないようにする
 * （鉄則5: 外部フォーマットのパース失敗でアプリを落とさない）。
 */
const ENV_MARKER = '__AITERM_ENV__';

/**
 * 解決した env から**持ち込まない**キー。
 *
 * どれも「env を取るために起動した使い捨てシェルの状態」であって、
 * ユーザーの環境ではない。`TMUX` 系は入れ子の tmux だと誤認させる。
 */
const PROBE_ONLY_KEYS: readonly string[] = ['_', 'SHLVL', 'PWD', 'OLDPWD', 'TMUX', 'TMUX_PANE'];

/** ログインシェルに実行させるコマンド。 */
export const SHELL_ENV_COMMAND = `printf '${ENV_MARKER}'; env -0`;

/**
 * `printf <目印>; env -0` の出力を解釈する。
 *
 * 目印が無ければ**空を返す**（＝ 何も混ぜない）。取れなかったときに
 * 現状維持へ縮退させるのがこの関数の役割で、推測で埋めない。
 */
export function parseShellEnvOutput(stdout: string): Record<string, string> {
  const markerAt = stdout.indexOf(ENV_MARKER);
  if (markerAt === -1) return {};

  const env: Record<string, string> = {};
  for (const record of stdout.slice(markerAt + ENV_MARKER.length).split('\0')) {
    if (record === '') continue;
    const eq = record.indexOf('=');
    // `=` を含まない行は env のレコードではない（rc の出力が紛れ込んだ等）。
    if (eq <= 0) continue;
    env[record.slice(0, eq)] = record.slice(eq + 1);
  }
  return env;
}

/**
 * 起動元の env に、ログインシェルから取れた env を重ねる。
 *
 * ⛔ **起動元が勝つ。解決した側は「起動元に無いキー」だけを埋める。**
 *
 * ⭐ **起動元が明示的に渡した env は、常にそちらが意図。** 埋めるだけなら
 * 直そうとしている不具合（GUI 起動で `~/.zshrc` の変数が1つも無い）は解消し、
 * 起動元が意図的に絞った env（E2E ハーネスの一時 HOME・偽 CLI を先頭に置いた
 * PATH など）を rc 由来の値で崩すこともない。`shell-path.ts` の
 * `mergePathEntries` が PATH について同じ結論を先に出している
 * （「既に解決できているものの解決先を変えない」）ので、揃えてある。
 *
 * ⛔ **最初は逆（解決した側が勝つ）で書き、「そうしないと Finder 起動で最小 PATH の
 * ままになる」と理由まで書いたが、それは測っていない推測だった。**
 * PATH は `ensureLoginShellPath()` が起動時に既に補完しており、ここの向きとは
 * 関係が無い。⚠ **さらに「`make e2e` の S56 が落ちたのがその証拠」とも書いたが、
 * それも誤り**（S56 の `demo-project %` 待ちは以前から知られた flaky で、
 * 単独で3回・フルセットの retry でも緑になる）。**この向きの根拠は上の原則だけ**で、
 * テストが証明したものではない。
 *
 * アプリが所有する値（TERM / TERM_PROGRAM など）は `buildPtyEnv` が**この後で**
 * 上書きするので、ここで気にしなくてよい。
 */
export function mergeUserEnv(
  base: NodeJS.ProcessEnv,
  resolved: Record<string, string>,
): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...base };
  for (const [key, value] of Object.entries(resolved)) {
    if (PROBE_ONLY_KEYS.includes(key)) continue;
    if (merged[key] !== undefined) continue;
    merged[key] = value;
  }
  return merged;
}
