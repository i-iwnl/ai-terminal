// 起動元の AI CLI セッションから継承してしまった「そのセッションの状態」を、
// アプリの process.env から落とす（Issue #253）。
//
// **なぜ要るか。** `.app` を Claude Code セッションの中から起動すると
// （`make install-app` や、エージェントに `open` させた場合など）、親セッションが
// 子プロセス向けに export している変数がアプリの `process.env` に焼き付く。
// `buildPtyEnv`（pty/manager.ts）は起動元の env を丸ごと引き継ぐので、
// **その値が全タブの子プロセスに配られる。**
//
// 受け取った `claude` は自分を「親セッションの子セッション」だと判定し、
//
//   - `~/.claude/sessions/<pid>.json` を書かない
//     -> `claude agents --json` に出ない -> サイドバーの一覧に出ない
//   - トランスクリプトを保存しない（画面にも
//     `Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION marker` と出る）
//     -> 履歴にも `--resume` にも残らない
//
// という縮退した動き方をする。**Finder / Dock から起動した .app では起きない**
// （launchd 由来の env にこれらは無い）ので、「開発中は動くのに配布版で動かない」の
// 逆、「配布版は動くのに、エージェントに起動させたときだけ動かない」という形で出る。
//
// 2026-08-14 実測（Claude Code 2.1.232）: 同じ pty + `zsh -l` から `claude` を起動し、
// env だけを変えた A/B で、継承したままだと `<pid>.json` が書かれず、
// `CLAUDE*` を落とすと書かれることを確認した。
//
// ⛔ **前方一致（`key.startsWith('CLAUDE')`）で落とさない。** `ELECTRON_*` と違い、
// この接頭辞には `CLAUDE_CONFIG_DIR` のような**利用者自身の設定**が混ざる。
// 落としてよいのは「起動元セッションの状態」だけなので、明示列挙にする。

/**
 * 起動元の AI CLI セッションの状態を表す環境変数。**アプリが引き継いではいけないもの。**
 *
 * ⭐ 判断基準は「そのセッション1つに固有の値か」。
 * 固有なら落とす（`CLAUDE_PID` はもう存在しないプロセスを指しうる）。
 * 利用者が `~/.zshrc` に書くたぐいの設定（`CLAUDE_CONFIG_DIR` / `ANTHROPIC_*`）は残す。
 *
 * ここから落としても、利用者が rc で設定していれば `mergeUserEnv`（pty/shellEnv.ts）が
 * ログインシェル由来の値で埋め直す。**その埋め直しを効かせるために、除去は
 * ログインシェルの解決より前に行う**（下の `purgeInheritedAgentSession` を参照）。
 */
export const INHERITED_AGENT_SESSION_KEYS: readonly string[] = [
  // 「自分は Claude Code の中で動いている」フラグ
  'CLAUDECODE',
  // 「自分は親セッションの子セッションである」マーカー。**この不具合の中心。**
  'CLAUDE_CODE_CHILD_SESSION',
  // 親セッションのプロセス ID / セッション ID
  'CLAUDE_PID',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_BRIDGE_SESSION_ID',
  // 親セッションのプロセス間通信の宛先と資格情報
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  // 親セッションの起動経路・実行バイナリ・思考量の設定
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_EFFORT',
];

/**
 * 与えられた env から、起動元セッションの状態キーを取り除いた**新しいオブジェクト**を返す。
 * 入力は書き換えない（純粋関数。単体テストはこちらを対象にする）。
 */
export function stripInheritedAgentSession(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const stripped: NodeJS.ProcessEnv = { ...env };
  for (const key of INHERITED_AGENT_SESSION_KEYS) {
    delete stripped[key];
  }
  return stripped;
}

/**
 * `process.env` から起動元セッションの状態キーを落とす。**Main の起動時に1度だけ呼ぶ。**
 *
 * ⛔ **`ensureLoginShellPath()` より前に呼ぶこと。** ログインシェルの探索は
 * `$SHELL -i -l -c` を Main の `process.env` を継承した子プロセスとして起動するので、
 * 先に落としておかないと**探索シェルが同じ値をそのまま再エクスポートし、
 * `mergeUserEnv` が埋め戻して無効化される。** `src/main/index.ts` は
 * モジュール読み込みの時点で探索を開始しているため、呼び出しは import の直後に置く。
 *
 * ⭐ **`buildPtyEnv` の中で落とさないこと。** そちらは `mergeUserEnv` の**あと**に走るので、
 * Dock から起動した（＝起動元に無い）場合に rc から埋まった**利用者の設定まで消す**。
 * 起動元の env を1回だけ掃除する形にすれば、探索シェル・PTY・
 * `claude agents --json` のすべてが同じ前提で動く。
 *
 * @returns 実際に落としたキー（診断・テスト用。何も無ければ空配列）
 */
export function purgeInheritedAgentSession(env: NodeJS.ProcessEnv = process.env): string[] {
  const removed: string[] = [];
  for (const key of INHERITED_AGENT_SESSION_KEYS) {
    if (env[key] === undefined) continue;
    delete env[key];
    removed.push(key);
  }
  return removed;
}
