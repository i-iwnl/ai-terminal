// Gemini CLI のバージョン判定。
//
// **なぜ要るか。** `--session-id <UUID>` は Gemini CLI 0.53.0 で確認したフラグで、
// それ以前の版には無い。未知のフラグを渡した gemini は
// `Unknown arguments: session-id, sessionId` と usage を出して**即座に終了する**
// （2026-08-06 に実測）。tmux でラップされていると、利用者からは
// **「開いた瞬間に終了したペイン」**にしか見えず、`describeSpawnError()` は
// ENOENT しか説明できないので原因に辿り着けない。
//
// そこで claude と同じ形にするのは「フラグが在るとき」だけにし、無ければ
// 従来どおり引数なしで起動する（tmux セッション名は ptyId 由来のまま = 縮退）。
//
// 判定そのものは純粋関数に切り出して `test/unit/` で固定する。このリポジトリの
// 既定の作法（`shouldSendResize` / `describeSpawnError` / `routeMenuAction` 等と同じ形）。

import { spawnSync } from 'node:child_process';

/** `--session-id` が入った最初の版。ローカルの 0.53.0 で実測して確認した。 */
const SESSION_ID_MIN = { major: 0, minor: 53, patch: 0 } as const;

/** `gemini --version` の出力から拾った版番号。 */
export interface GeminiVersion {
  major: number;
  minor: number;
  patch: number;
}

/**
 * `gemini --version` の出力から版番号を取り出す。
 *
 * 実測（0.53.0）では改行つきの `0.53.0` だけが出る。E2E の偽 CLI は
 * `0.53.0-e2e-fake` のように接尾辞を付けるので、**行全体を完全一致で見ない**。
 * 取れなければ `undefined`（呼び出し側が安全側へ倒す）。
 */
export function parseGeminiVersion(output: string): GeminiVersion | undefined {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(output);
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/**
 * `--session-id` を渡してよいか。
 *
 * ⛔ **版が読み取れなければ false。** 「新しいはずだから渡す」に倒すと、
 * 古い CLI で**新規タブが起動直後に死ぬ**（利用者から原因が見えない故障）。
 * 渡さない側に外れても起きるのは「tmux セッション名が安定しない」= 従来の挙動で、
 * 失うものが無い。**非対称なので安全側は常に false。**
 */
export function supportsGeminiSessionId(versionOutput: string): boolean {
  const v = parseGeminiVersion(versionOutput);
  if (!v) return false;
  if (v.major !== SESSION_ID_MIN.major) return v.major > SESSION_ID_MIN.major;
  if (v.minor !== SESSION_ID_MIN.minor) return v.minor > SESSION_ID_MIN.minor;
  return v.patch >= SESSION_ID_MIN.patch;
}

let cache: boolean | undefined;

/**
 * 実際に `gemini --version` を1回だけ実行して判定し、以後はキャッシュを返す。
 * spawn のたびに聞き直すのはコストなので避ける（`isTmuxAvailable()` と同じ形）。
 */
export function geminiSupportsSessionId(): boolean {
  if (cache !== undefined) return cache;
  try {
    const result = spawnSync('gemini', ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    });
    cache = result.error === undefined && result.status === 0
      ? supportsGeminiSessionId(result.stdout ?? '')
      : false;
  } catch {
    cache = false;
  }
  return cache;
}

/** テスト用。プロセスをまたがないので本番からは呼ばない。 */
export function resetGeminiVersionCacheForTest(): void {
  cache = undefined;
}
