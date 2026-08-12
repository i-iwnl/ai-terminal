// 偽 tmux に食わせる `list-panes` 出力の組み立て（E2E フィクスチャ）。
//
// ⛔ **行を手で `join('\x1f')` しないこと。** 実装側の `LIVE_SESSION_FORMAT` に
// フィールドを1つ足しただけで、手書きのフィクスチャは**全フィールドが1つずれる**。
// ずれると `providerOf()` が cwd を起動コマンドとして読んで `undefined` を返し、
// **行が丸ごと捨てられて `recoverable` が永久に false になる**（= S104 / S105 が落ちる）。
//
// これは実際に起きた。`#{pane_pid}` を第2フィールドに足した周で、パース側だけを直して
// フィクスチャ2本を取り残し、`make check` が全緑のまま E2E だけが赤くなった（2026-08-07）。
// **型が付かない文字列なので typecheck も lint も単体テストも1つも気づかない。**
//
// そこで**書式そのものから行を組み立てる**。フィールドが増えても順序が変わっても、
// ここを通していればフィクスチャは自動的に追従する。値を持たない新フィールドが
// 現れたら例外を投げるので、**取り残しはその場で分かる**。

import { LIVE_SESSION_FORMAT } from '../../src/main/pty/tmuxSessions';

/** 実装と同じ区切り（0x1f）。`LIVE_SESSION_FORMAT` はこれで join されている。 */
const FIELD_SEPARATOR = '\x1f';

/** 1ペインぶんの中身。tmux の書式指定子ごとに値を持つ。 */
export interface LivePaneFixture {
  /** `#{session_name}`。`aiterm-<agentSessionId>` の形にする。 */
  sessionName: string;
  /** `#{pane_start_command}`。先頭語から provider が確定する。 */
  startCommand: string;
  /** `#{pane_current_path}`。 */
  cwd: string;
  /** `#{pane_pid}`。省略時は決め打ちの値を使う（pid そのものを見ない spec 向け）。 */
  panePid?: number;
}

/** pid を指定しない spec のための既定値。実在しないことに意味は無い。 */
const DEFAULT_PANE_PID = 4242;

/**
 * `LIVE_SESSION_FORMAT` の並びどおりに1行を組み立てる。
 *
 * 書式に未知のフィールドが増えていたら**投げる**。黙って空文字を埋めると、
 * この関数の存在意義（取り残しの検出）が無くなる。
 */
export function livePaneLine(fixture: LivePaneFixture): string {
  const values: Record<string, string> = {
    '#{session_name}': fixture.sessionName,
    '#{pane_pid}': String(fixture.panePid ?? DEFAULT_PANE_PID),
    '#{pane_start_command}': fixture.startCommand,
    '#{pane_current_path}': fixture.cwd,
  };

  return LIVE_SESSION_FORMAT.split(FIELD_SEPARATOR)
    .map((field) => {
      const value = values[field];
      if (value === undefined) {
        throw new Error(
          `LIVE_SESSION_FORMAT に未知のフィールド ${field} が増えています。` +
            `e2e/fixtures/tmuxLivePanes.ts に値を足してください。`,
        );
      }
      return value;
    })
    .join(FIELD_SEPARATOR);
}

/** 複数ペインぶんをまとめて（末尾の改行込みで）組み立てる。 */
export function livePanesFile(fixtures: readonly LivePaneFixture[]): string {
  return fixtures.map(livePaneLine).join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// 偽 tmux が書き出すファイルの読み取り（Issue #244）
// ---------------------------------------------------------------------------
//
// ⛔ **`readFileSync` で直接読まないこと。** タブの DOM が立つのは Renderer が
// spawn の結果を受けた時点で、`tmux-session-name.txt` を書くのは**その先で
// exec される偽 tmux**。待たずに読むと、**2本目のつもりで1本目の名前を読む**。
// 2026-08-09 の code-review が S107 で指摘し、直後に S90 でも同じ形を踏んだので
// ここへ切り出した（同じ罠を spec ごとに書き直さない）。

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '@playwright/test';

/** 偽 tmux が最後に `new-session -s` で受けたセッション名（無ければ空文字）。 */
export function readTmuxSessionName(fixturesDir: string): string {
  const p = join(fixturesDir, 'tmux-session-name.txt');
  return existsSync(p) ? readFileSync(p, 'utf8').trim() : '';
}

/** 偽 tmux が `kill-session` で受けた名前の記録（無ければ空文字）。 */
export function readKilledTmuxSessions(fixturesDir: string): string {
  const p = join(fixturesDir, 'tmux-killed-sessions.txt');
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
}

/**
 * 偽 tmux が**新しい**セッション名を書き終えるまで待って読む。
 *
 * `previous` に直前のセッション名（1本目なら空文字）を渡すこと。
 * 「`aiterm-` で始まる」だけでなく「前回と変わった」まで待つのが要点で、
 * これが無いと**同じ名前を2回読んでも緑になる**。
 */
export async function waitForNewTmuxSessionName(
  fixturesDir: string,
  previous: string,
): Promise<string> {
  await expect
    .poll(() => readTmuxSessionName(fixturesDir), {
      timeout: 15_000,
      message: '偽 tmux がセッション名を書いていない',
    })
    .toMatch(/^aiterm-[0-9a-f-]{36}$/i);
  await expect
    .poll(() => readTmuxSessionName(fixturesDir), {
      timeout: 15_000,
      message: `セッション名が前回のまま変わっていない: ${previous}`,
    })
    .not.toBe(previous);
  return readTmuxSessionName(fixturesDir);
}
