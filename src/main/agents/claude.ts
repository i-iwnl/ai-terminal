// claude agents --json の実行と結果のパース。
//
// CLAUDE.md の鉄則4（外部コマンドの出力パースは1ファイルに閉じ込める）に従い、
// `claude agents --json` の出力形式に関する知識はこのファイルの中だけに置く。
// 呼び出し側（poller.ts）は本ファイルが返す ClaudeAgentsResult / AgentTask だけを見ればよい。
//
// 実機で確認した出力形式（Claude Code v2.1.220）は docs/PLAN.md の
// 「2-3 実機で検証した技術的事実」を参照。ただしこの形式は CLI のバージョンで
// 変わりうるため、パースは常に防御的に書く（1要素の失敗が他要素に波及しないこと、
// 想定外の形でも例外を投げないこと）。

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { AgentTask } from '@shared/ipc';

const execFileAsync = promisify(execFile);

/** claude コマンド名。PATH 上に存在すること前提。 */
const CLAUDE_BIN = 'claude';

/** ハングした CLI にポーリングが引きずられないためのタイムアウト。 */
const EXEC_TIMEOUT_MS = 5000;

export interface ClaudeAgentsResult {
  tasks: AgentTask[];
  /** 取得・パースに失敗した場合の理由。成功時は undefined */
  error?: string;
  /**
   * error の機械判定用。'not-found' は claude が PATH に無い（ENOENT）ことを表し、
   * 呼び出し側（poller.ts）が PATH の再解決を試みる判断に使う。
   */
  errorKind?: 'not-found' | 'timeout' | 'failed';
}

/**
 * `claude agents --json` を実行し、結果を AgentTask[] に正規化して返す。
 * - claude コマンドが存在しない
 * - 非ゼロ終了する
 * - タイムアウトする
 * - 出力が JSON として不正、または想定外の形
 * のいずれであっても例外を投げず、error にその理由を詰めて返す。
 *
 * @param cwd 指定すると `--cwd <path>` で絞り込む。省略時はマシン全体。
 */
export async function listClaudeAgents(cwd?: string): Promise<ClaudeAgentsResult> {
  const args = ['agents', '--json'];
  if (cwd) {
    args.push('--cwd', cwd);
  }

  let stdout: string;
  try {
    const result = await execFileAsync(CLAUDE_BIN, args, {
      timeout: EXEC_TIMEOUT_MS,
      windowsHide: true,
    });
    stdout = result.stdout;
  } catch (err) {
    const described = describeExecError(err);
    return { tasks: [], error: described.message, errorKind: described.kind };
  }

  return parseAgentsJson(stdout);
}

/** execFile が失敗したときのエラーを、日本語の短い説明と機械判定用の種別に変換する。 */
function describeExecError(err: unknown): { message: string; kind: 'not-found' | 'timeout' | 'failed' } {
  if (err && typeof err === 'object') {
    const e = err as NodeJS.ErrnoException & { killed?: boolean; stderr?: string };

    if (e.code === 'ENOENT') {
      return { message: 'claude コマンドが見つかりません（PATH を確認してください）', kind: 'not-found' };
    }
    if (e.killed) {
      return {
        message: `claude agents --json の実行がタイムアウトしました（${EXEC_TIMEOUT_MS}ms）`,
        kind: 'timeout',
      };
    }
    const stderrSnippet = typeof e.stderr === 'string' && e.stderr.trim().length > 0
      ? `: ${e.stderr.trim().slice(0, 200)}`
      : '';
    const message = e.message ?? '不明なエラー';
    return { message: `claude agents --json の実行に失敗しました（${message}）${stderrSnippet}`, kind: 'failed' };
  }
  return { message: 'claude agents --json の実行に失敗しました（不明なエラー）', kind: 'failed' };
}

/**
 * 防御的パース。
 * JSON.parse の結果は unknown として受け、配列であることを確認したうえで、
 * 要素ごとに sessionId が文字列であるものだけを AgentTask として採用する。
 * それ以外のフィールドは型が合えば拾い、合わなければ undefined にする。
 */
function parseAgentsJson(stdout: string): ClaudeAgentsResult {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    // 実行中セッションが無いだけの可能性が高いので、空配列として扱う（エラー扱いしない）
    return { tasks: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return { tasks: [], error: 'claude agents --json の出力が JSON として解析できませんでした' };
  }

  if (!Array.isArray(parsed)) {
    return { tasks: [], error: 'claude agents --json の出力が配列ではありませんでした' };
  }

  const tasks: AgentTask[] = [];
  for (const item of parsed) {
    const task = toAgentTask(item);
    if (task) tasks.push(task);
    // パースできない要素は黙って読み飛ばす（1要素の失敗を他要素に波及させない）
  }

  return { tasks };
}

/** 1要素を AgentTask に変換する。sessionId が無い/文字列でない場合は undefined を返す。 */
function toAgentTask(item: unknown): AgentTask | undefined {
  if (typeof item !== 'object' || item === null) return undefined;
  const src = item as Record<string, unknown>;

  const sessionId = src.sessionId;
  if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined;

  return {
    sessionId,
    pid: typeof src.pid === 'number' ? src.pid : undefined,
    cwd: typeof src.cwd === 'string' ? src.cwd : undefined,
    kind: typeof src.kind === 'string' ? src.kind : undefined,
    status: typeof src.status === 'string' ? src.status : undefined,
    name: typeof src.name === 'string' ? src.name : undefined,
    startedAt: typeof src.startedAt === 'number' ? src.startedAt : undefined,
    // このアプリが起動したセッションかどうかは poller.ts 側（markOwnedSession）が確定させる。
    // ここでは常に false を仮置きする。
    ownedByApp: false,
  };
}
