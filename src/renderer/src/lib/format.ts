// 相対時刻・経過時間・パスの表示整形（日本語）。
// このファイルに閉じ込めておき、表記を変えたくなったらここだけ直せばよいようにする。

import type { SessionHistoryEntry } from '@shared/ipc';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * 過去の時刻（epoch ミリ秒）を「3分前」のような相対表記にする。
 * 履歴一覧の updatedAt 表示に使う。
 */
export function formatRelativeTime(pastMs: number, nowMs: number = Date.now()): string {
  const diff = Math.max(0, nowMs - pastMs);
  if (diff < 10 * SECOND) return 'たった今';
  if (diff < MINUTE) return `${Math.floor(diff / SECOND)}秒前`;
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}分前`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}時間前`;
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)}日前`;
  return new Date(pastMs).toLocaleDateString('ja-JP');
}

/**
 * 起動時刻からの経過時間を「12分34秒」のような表記にする。
 * タスク一覧の経過時間表示に使う。
 */
export function formatElapsed(startedAtMs: number, nowMs: number = Date.now()): string {
  const diff = Math.max(0, nowMs - startedAtMs);
  const totalSeconds = Math.floor(diff / SECOND);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}時間${minutes}分`;
  if (minutes > 0) return `${minutes}分${seconds}秒`;
  return `${seconds}秒`;
}

/**
 * 「あなたの番」になってからの経過時間を「3分待たせています」のような文言にする。
 *
 * `formatElapsed` はセッション起動からの通算（例: 「37時間28分」）で、
 * 「何分待たせているか」には答えられない。`sinceMs` には
 * `AgentTask.yourTurnSince`（poller.ts が busy -> 非busy の遷移を検知した時刻）を渡す。
 */
export function formatWaitingSince(sinceMs: number, nowMs: number = Date.now()): string {
  return `${formatElapsed(sinceMs, nowMs)}待たせています`;
}

/** cwd のパスから末尾のディレクトリ名（ベース名）だけを取り出す。 */
export function basename(path: string | undefined): string {
  if (!path) return '(不明)';
  const trimmed = path.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  if (idx < 0) return trimmed;
  const tail = trimmed.slice(idx + 1);
  return tail.length > 0 ? tail : trimmed;
}

/** セッション ID の先頭8文字を表示用に切り出す。 */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

/**
 * 履歴一覧に表示するタイトルを決める。
 * 上書きタイトル（Main が title に重ねて返す）> firstPrompt（正常時のみ）> フォールバック
 * の優先順位で、HistoryList と再開後のタブタイトルの両方から参照する単一の正。
 */
export function sessionDisplayTitle(entry: SessionHistoryEntry): string {
  if (entry.parseError) {
    return entry.title ?? `セッション ${shortId(entry.sessionId)}`;
  }
  return entry.title ?? entry.firstPrompt ?? `セッション ${shortId(entry.sessionId)}`;
}
