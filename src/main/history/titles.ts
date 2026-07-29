// 履歴タイトルの上書き（~/.ai-terminal/session-titles.json）の読み書き。
//
// CLI 側のファイル（claude の JSONL 等）は書き換えず、アプリ側で
// 「安定キー（provider:stableId） -> カスタムタイトル」を保存し、
// 履歴一覧を返すときに Main 側で title に重ねる。
// 実装パターンは src/main/config.ts（DEFAULT / 防御的 read / プロセス内キャッシュ /
// 全書き換え write / registerHandlers）を雛形にして揃えている。

import { ipcMain } from 'electron';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { IpcInvoke, type HistoryProvider, type SetSessionTitleRequest } from '@shared/ipc';
import { dataDir } from '../data-dir';

const TITLES_DIR = dataDir();
const TITLES_PATH = join(TITLES_DIR, 'session-titles.json');

/** 保存キーの型。provider:stableId -> title */
type TitleOverrides = Record<string, string>;

const DEFAULT_OVERRIDES: TitleOverrides = {};

let cached: TitleOverrides | null = null;

function makeKey(provider: HistoryProvider, stableId: string): string {
  return `${provider}:${stableId}`;
}

/**
 * 外部 JSON を安全に TitleOverrides へ寄せる。
 * オブジェクトでない・値が string でないエントリは黙って捨てる。
 * ファイルが壊れていてもアプリを落とさないことを優先する。
 */
function coerce(raw: unknown): TitleOverrides {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_OVERRIDES };
  const src = raw as Record<string, unknown>;

  const result: TitleOverrides = {};
  for (const [key, value] of Object.entries(src)) {
    if (typeof value === 'string') {
      result[key] = value;
    }
  }
  return result;
}

/** 上書きマップ全体を取得する。初回はファイルから読み、以降はキャッシュを返す。 */
function getOverrides(): TitleOverrides {
  if (cached) return cached;
  try {
    const text = readFileSync(TITLES_PATH, 'utf8');
    cached = coerce(JSON.parse(text) as unknown);
  } catch {
    // 未作成・パース失敗ともに空マップで縮退する
    cached = { ...DEFAULT_OVERRIDES };
  }
  return cached;
}

/** 上書きマップ全体を保存する。保存に失敗してもメモリ上の値は更新する。 */
function saveOverrides(next: TitleOverrides): void {
  cached = next;
  try {
    mkdirSync(TITLES_DIR, { recursive: true });
    writeFileSync(TITLES_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  } catch (err) {
    console.error('[history/titles] 保存に失敗しました:', err);
  }
}

/** 指定セッションのタイトル上書きを取得する。無ければ undefined。 */
export function getTitleOverride(provider: HistoryProvider, stableId: string): string | undefined {
  return getOverrides()[makeKey(provider, stableId)];
}

/** タイトル上書きを設定する。trim 後に空なら該当キーを削除（上書き解除）する。 */
export function setTitleOverride(req: SetSessionTitleRequest): void {
  const key = makeKey(req.provider, req.stableId);
  const trimmed = req.title.trim();
  const next = { ...getOverrides() };

  if (trimmed.length === 0) {
    delete next[key];
  } else {
    next[key] = trimmed;
  }

  saveOverrides(next);
}

/**
 * セッションタイトル関連の IPC ハンドラを登録する。
 * Renderer からの入力は型定義上 SetSessionTitleRequest だが、IPC 境界を越えた値を
 * 完全には信用せず、想定外の形なら何もせず正常終了する（アプリを落とさない）。
 */
export function registerSessionTitleHandlers(): void {
  ipcMain.handle(IpcInvoke.historySetTitle, (_event, req: SetSessionTitleRequest): void => {
    if (
      typeof req?.stableId !== 'string' ||
      typeof req?.title !== 'string' ||
      (req.provider !== 'claude' && req.provider !== 'gemini')
    ) {
      return;
    }
    setTitleOverride(req);
  });
}
