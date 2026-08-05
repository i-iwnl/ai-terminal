// PTY の起動に失敗したときに通知バナーへ出す文言（Issue #146 / #180 周1）。
//
// **なぜ切り出したか。** この判定は `useTabs.ts` の中の関数で、E2E から踏めない。
// `window.api.pty.spawn()` が **reject したときだけ**通るが、実測した限り
// ハーネスから reject を作れない:
//
// | 試したこと | 結果 |
// |---|---|
// | `config.shell` を存在しないパスにする | **投げない。**「<name> が終了しました（コード 1）」= 終了通知の経路 |
// | `config.shell` をディレクトリ / 非実行ファイルにする | 同上 |
// | cwd を消してから新しいタブを開く | 同上（タブは生まれ、シェルがコード 1 で終了する） |
// | preload の `api.pty.spawn` を差し替える | **`contextBridge` が凍結していて `Cannot redefine property`** |
//
// 原因は node-pty の性質で、**exec の失敗は子プロセス側で非同期に起きる**
// （`e2e/specs/S11-cli-missing.spec.ts` が同じことを実測して記録している）。
// `src/main/pty/manager.ts` が同期的に投げるのは「不正な pty:spawn リクエスト」と
// forkpty そのものの失敗だけで、どちらもハーネスからは作れない。
//
// **そこで、このリポジトリが8回採ってきた形に合わせる**（`shouldSendResize` /
// `computeYourTurnSince` / `rovingTabindex` / `passesModifierGate` / `paneTree` /
// `paneHeader` / `paneSplitter` / `chromeTextRemainsReadable`）:
// **観測可能な出力を作れない判定は、純粋関数に切り出して直接固定する。**
//
// ⛔ **E2E に「到達できたことにする」細工を書かない。** Main に E2E 専用の
// 環境変数を読ませる案は採らなかった（Main は `AI_TERMINAL_E2E_*` を1つも読んでおらず、
// 製品コードに test-only の分岐を入れる前例を新設することになる）。

import type { PtyKind } from '@shared/ipc';

/**
 * 起動失敗の理由を、利用者が次に取れる行動の形にする。
 *
 * **`kind` で文言を分けるのが要点。** シェルは PATH の話にならない
 * （決定順が `config.shell -> $SHELL -> /bin/zsh` なので「見つからない」なら
 * 設定かシステムの問題）が、claude / gemini は **CLI を入れていないだけ**のことが多く、
 * そのときに生のエラー文を出しても次の行動につながらない。
 */
export function describeSpawnError(err: unknown, kind: PtyKind): string {
  const message = err instanceof Error ? err.message : String(err);
  if (kind !== 'shell' && /not found|enoent|no such file/i.test(message)) {
    return `${kind} コマンドが見つかりません。PATH を確認してください。`;
  }
  return `起動に失敗しました: ${message}`;
}
