// メモ（~/.ai-terminal/memos.json）の読み書き。
//
// 「全体メモ」1枚と、履歴セッションに紐付く「セッションメモ」を同じファイルに
// 1つのマップとして持つ。実装パターンは src/main/history/titles.ts
// （DEFAULT / 防御的 read / プロセス内キャッシュ / 全書き換え write /
// registerHandlers）を雛形にして揃えている。
//
// セッションメモの保存キーには session-titles.json と同じ stableId を使う。
// claude は sessionId と同じ、gemini は --list-sessions 行末の内部 UUID で、
// どちらも並び替えに強い（行番号由来の sessionId は使わない）。

import { ipcMain } from 'electron';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import {
  IpcInvoke,
  type HistoryProvider,
  type ListMemosResult,
  type MemoEntry,
  type SetMemoRequest,
} from '@shared/ipc';
import { dataDir } from '../data-dir';

const MEMO_DIR = dataDir();
const MEMO_PATH = join(MEMO_DIR, 'memos.json');

/** 全体メモの保存キー。セッションキーは `session:` 始まりなので衝突しない。 */
const GLOBAL_KEY = 'global';

/** ファイルに書く1件分。表示名はセッションメモのみ持つ。 */
interface StoredMemo {
  body: string;
  updatedAt: number;
  title?: string;
}

/** 保存キー -> メモ本体 */
type MemoMap = Record<string, StoredMemo>;

const DEFAULT_MEMOS: MemoMap = {};

let cached: MemoMap | null = null;

function sessionKey(provider: HistoryProvider, stableId: string): string {
  return `session:${provider}:${stableId}`;
}

/**
 * セッションメモの保存キーを provider / stableId に戻す。
 * 想定外のキー（全体メモ、手で書き足された行）は undefined を返して読み捨てる。
 *
 * stableId 側に `:` が含まれても壊れないよう、分割は先頭2つまでに限る。
 */
function parseSessionKey(
  key: string,
): { provider: HistoryProvider; stableId: string } | undefined {
  if (!key.startsWith('session:')) return undefined;
  const rest = key.slice('session:'.length);
  const sep = rest.indexOf(':');
  if (sep <= 0) return undefined;
  const provider = rest.slice(0, sep);
  const stableId = rest.slice(sep + 1);
  if (provider !== 'claude' && provider !== 'gemini') return undefined;
  if (stableId.length === 0) return undefined;
  return { provider, stableId };
}

/**
 * 外部 JSON を安全に MemoMap へ寄せる。
 * 形が合わないエントリは黙って捨てる。ファイルが壊れていてもアプリを落とさない。
 */
function coerce(raw: unknown): MemoMap {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_MEMOS };
  const src = raw as Record<string, unknown>;

  const result: MemoMap = {};
  for (const [key, value] of Object.entries(src)) {
    if (typeof value !== 'object' || value === null) continue;
    const v = value as Record<string, unknown>;
    if (typeof v.body !== 'string') continue;
    result[key] = {
      body: v.body,
      // 壊れた updatedAt は 0 に寄せる（並び順が末尾になるだけで表示は壊れない）
      updatedAt:
        typeof v.updatedAt === 'number' && Number.isFinite(v.updatedAt) ? v.updatedAt : 0,
      title: typeof v.title === 'string' ? v.title : undefined,
    };
  }
  return result;
}

/** メモ全体を取得する。初回はファイルから読み、以降はキャッシュを返す。 */
function getMemos(): MemoMap {
  if (cached) return cached;
  try {
    const text = readFileSync(MEMO_PATH, 'utf8');
    cached = coerce(JSON.parse(text) as unknown);
  } catch {
    // 未作成・パース失敗ともに空マップで縮退する
    cached = { ...DEFAULT_MEMOS };
  }
  return cached;
}

/** メモ全体を保存する。保存に失敗してもメモリ上の値は更新する。 */
function saveMemos(next: MemoMap): void {
  cached = next;
  try {
    mkdirSync(MEMO_DIR, { recursive: true });
    writeFileSync(MEMO_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  } catch (err) {
    console.error('[memo] 保存に失敗しました:', err);
  }
}

/**
 * 保存済みのメモを Renderer に返す形へ組み立てる。
 * 全体メモは未作成でも空のエントリを返し、呼び出し側で「無い場合」を分岐させない。
 * セッションメモは updatedAt の降順（同着はキー順）で安定させる。
 */
export function buildListResult(memos: MemoMap): ListMemosResult {
  const stored = memos[GLOBAL_KEY];
  const global: MemoEntry = {
    scope: 'global',
    body: stored?.body ?? '',
    updatedAt: stored?.updatedAt ?? 0,
  };

  const sessions: MemoEntry[] = [];
  for (const [key, value] of Object.entries(memos)) {
    const parsed = parseSessionKey(key);
    if (!parsed) continue;
    sessions.push({
      scope: 'session',
      provider: parsed.provider,
      stableId: parsed.stableId,
      body: value.body,
      updatedAt: value.updatedAt,
      title: value.title,
    });
  }
  sessions.sort((a, b) => {
    if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
    return (a.stableId ?? '').localeCompare(b.stableId ?? '');
  });

  return { global, sessions };
}

/**
 * メモを1件更新した結果のマップを返す（純粋関数。保存はしない）。
 *
 * - 本文が trim 後に空ならそのメモを削除する（空メモが一覧に残り続けないように）
 * - title を省略した場合は保存済みの表示名を維持する
 * - セッションメモなのに provider / stableId が無いリクエストは、何も変えずに返す
 */
export function applyMemoUpdate(
  memos: MemoMap,
  req: SetMemoRequest,
  nowMs: number,
): MemoMap {
  let key: string;
  if (req.scope === 'global') {
    key = GLOBAL_KEY;
  } else {
    if (!req.provider || !req.stableId) return memos;
    key = sessionKey(req.provider, req.stableId);
  }

  const next = { ...memos };
  const trimmed = req.body.trim();
  if (trimmed.length === 0) {
    delete next[key];
    return next;
  }

  next[key] = {
    // 本文は trim せずそのまま保存する（末尾の改行やインデントは書いた人の意図）。
    // 「空かどうか」の判定にだけ trim を使う。
    body: req.body,
    updatedAt: nowMs,
    title: req.title ?? memos[key]?.title,
  };
  return next;
}

/** IPC 境界を越えた値を信用せず、SetMemoRequest として妥当か判定する。 */
function isSetMemoRequest(value: unknown): value is SetMemoRequest {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.scope !== 'global' && v.scope !== 'session') return false;
  if (typeof v.body !== 'string') return false;
  if (v.provider !== undefined && v.provider !== 'claude' && v.provider !== 'gemini') return false;
  if (v.stableId !== undefined && typeof v.stableId !== 'string') return false;
  if (v.title !== undefined && typeof v.title !== 'string') return false;
  return true;
}

/**
 * メモ関連の IPC ハンドラを登録する。
 * 不正なリクエストは何も変えずに現在の一覧を返す（アプリを落とさない）。
 */
export function registerMemoHandlers(): void {
  ipcMain.handle(IpcInvoke.memoList, (): ListMemosResult => buildListResult(getMemos()));

  ipcMain.handle(IpcInvoke.memoSet, (_event, rawReq: unknown): ListMemosResult => {
    if (!isSetMemoRequest(rawReq)) return buildListResult(getMemos());
    const next = applyMemoUpdate(getMemos(), rawReq, Date.now());
    saveMemos(next);
    return buildListResult(next);
  });
}
