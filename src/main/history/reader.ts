// 履歴（セッション一覧 / resume）の読み取り。
//
// CLAUDE.md の鉄則4・5に従い、以下2点をこのファイルに閉じ込める。
//   1. `~/.claude/projects/*.jsonl` の内部スキーマに関する知識
//   2. `gemini --list-sessions` の出力フォーマットに関する知識
// 呼び出し側（IPC 経由の Renderer）は SessionHistoryEntry / ListHistoryResult だけを見ればよい。
// CLI 側の仕様変更で壊れたとき、直す場所がここ1箇所で済むようにする。
//
// 公式ドキュメントが「Claude Code の JSONL は内部フォーマットであり、バージョン間で
// 変わりうる。直接パースするスクリプトは壊れる可能性がある」と明記しているため、
// パースは常に防御的に書く。1行・1ファイルの失敗が一覧全体を壊してはいけない。

import { ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import { open, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  IpcInvoke,
  type HistoryProvider,
  type ListHistoryRequest,
  type ListHistoryResult,
  type SessionHistoryEntry,
} from '@shared/ipc';

import { projectHistoryDir } from './paths';
import { getTitleOverride } from './titles';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// 共通の調整値
// ---------------------------------------------------------------------------

/** limit 省略時の既定件数。 */
const DEFAULT_LIMIT = 50;
/** limit に指定できる上限（暴走防止）。 */
const MAX_LIMIT = 500;
/** 一覧表示用プレビュー文字列の最大長。 */
const PREVIEW_MAX_LEN = 200;

function normalizeLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

/** 一覧表示用に改行を空白へ潰し、指定長で切り詰める。 */
function truncateForPreview(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= PREVIEW_MAX_LEN) return collapsed;
  return `${collapsed.slice(0, PREVIEW_MAX_LEN)}...`;
}

/**
 * 配列の各要素に非同期関数を適用するが、同時実行数を limit 件に制限する。
 * 数百ファイルを一気に fs.open するとファイルディスクリプタを食い潰しかねないため、
 * Promise.all を使わずワーカープール方式にしている。
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;
      results[current] = await fn(items[current]);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

// ---------------------------------------------------------------------------
// Claude: ~/.claude/projects/<encoded>/<sessionId>.jsonl
// ---------------------------------------------------------------------------

const JSONL_EXT = '.jsonl';
/** プレビュー抽出のために読む先頭バイト数。ファイル全体は絶対に読まない。 */
const CLAUDE_PREVIEW_BYTES = 512 * 1024;
/** プレビュー抽出で走査する行数の安全上限（通常はタイトル/冒頭プロンプトが揃い次第、早期終了する）。 */
const CLAUDE_PREVIEW_MAX_LINES = 200;
/** 同時に開くファイル数の上限。 */
const CLAUDE_MAX_CONCURRENCY = 8;

interface StatedJsonlFile {
  sessionId: string;
  filePath: string;
  mtimeMs: number;
}

/** 1ディレクトリぶんの *.jsonl を stat する。読めないディレクトリは空扱い（ENOENT は呼び出し側で判定）。 */
async function statJsonlDir(dir: string): Promise<StatedJsonlFile[]> {
  const dirents = await readdir(dir, { withFileTypes: true });
  const jsonlNames = dirents
    .filter((d) => d.isFile() && d.name.endsWith(JSONL_EXT))
    .map((d) => d.name);

  const stated = await mapWithConcurrency(
    jsonlNames,
    CLAUDE_MAX_CONCURRENCY,
    async (name): Promise<StatedJsonlFile | undefined> => {
      const filePath = join(dir, name);
      try {
        const st = await stat(filePath);
        return { sessionId: name.slice(0, -JSONL_EXT.length), filePath, mtimeMs: st.mtimeMs };
      } catch {
        // 1ファイルの stat 失敗（レース等）で全体を諦めない。読み飛ばす。
        return undefined;
      }
    },
  );

  return stated.filter((f): f is StatedJsonlFile => f !== undefined);
}

async function listClaudeHistory(req: ListHistoryRequest): Promise<ListHistoryResult> {
  const dir = projectHistoryDir(req.cwd);
  const limit = normalizeLimit(req.limit);

  let stated: StatedJsonlFile[];
  try {
    stated = await statJsonlDir(dir);
  } catch (err) {
    if (isEnoent(err)) {
      // まだこの cwd で claude セッションを作っていないだけ。エラー扱いにしない。
      return { entries: [] };
    }
    return { entries: [], error: describeReaddirError(err) };
  }

  const sorted = stated.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit);

  const entries = await mapWithConcurrency(sorted, CLAUDE_MAX_CONCURRENCY, (file) =>
    buildClaudeEntry(file),
  );

  return { entries };
}

/**
 * Issue #20 I-3「すべてのフォルダを見る」。cwd の絞り込みを外し、
 * ~/.claude/projects 配下の全フォルダを横断して集計する。
 *
 * 1フォルダぶんの処理（statJsonlDir + buildClaudeEntry）は listClaudeHistory と共通化してある。
 * 違うのはスキャン対象がフォルダ1つではなく全フォルダである点だけ。
 */
async function listAllClaudeHistory(limit: number): Promise<ListHistoryResult> {
  const root = join(homedir(), '.claude', 'projects');

  let projectDirs;
  try {
    projectDirs = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory());
  } catch (err) {
    if (isEnoent(err)) return { entries: [] };
    return { entries: [], error: describeReaddirError(err) };
  }

  // フォルダ単位で件数を絞ると「新しいフォルダの古いセッション」が「古いフォルダの
  // 新しいセッション」を押しのけて一覧から漏れる。必ず全フォルダぶんを集めてから
  // まとめて mtime 降順に並べ替え、最後に1回だけ limit で切る。
  const perDir = await Promise.all(
    projectDirs.map((d) => statJsonlDir(join(root, d.name)).catch(() => [] as StatedJsonlFile[])),
  );
  const merged = perDir.flat().sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit);

  const entries = await mapWithConcurrency(merged, CLAUDE_MAX_CONCURRENCY, (file) =>
    buildClaudeEntry(file),
  );

  return { entries };
}

function describeReaddirError(err: unknown): string {
  const message = err instanceof Error ? err.message : '不明なエラー';
  return `セッション履歴ディレクトリの読み取りに失敗しました（${message}）`;
}

async function buildClaudeEntry(file: StatedJsonlFile): Promise<SessionHistoryEntry> {
  const base: SessionHistoryEntry = {
    provider: 'claude',
    sessionId: file.sessionId,
    updatedAt: Math.round(file.mtimeMs),
    // claude はタイトル上書きの保存キーに sessionId をそのまま使える。
    // parseError で縮退するパスでも sessionId は分かるため、ここで先に付けておく。
    stableId: file.sessionId,
  };

  try {
    const preview = await extractClaudePreview(file.filePath);
    return { ...base, ...preview };
  } catch (err) {
    // JSONL のスキーマ前提が崩れていても、sessionId と updatedAt だけで縮退表示する。
    const message = err instanceof Error ? err.message : '不明なエラー';
    return { ...base, parseError: `プレビューの取得に失敗しました（${message}）` };
  }
}

interface ClaudePreview {
  title?: string;
  firstPrompt?: string;
  cwd?: string;
  gitBranch?: string;
}

/** ファイル先頭の一部だけを読み、防御的にパースしてプレビュー情報を抽出する。 */
async function extractClaudePreview(filePath: string): Promise<ClaudePreview> {
  const chunk = await readPrefix(filePath, CLAUDE_PREVIEW_BYTES);
  const lines = chunk.split('\n').slice(0, CLAUDE_PREVIEW_MAX_LINES);

  const preview: ClaudePreview = {};
  let nonEmptyLines = 0;
  let parsedLines = 0;

  for (const line of lines) {
    if (allPreviewFieldsFound(preview)) break;
    if (line.trim().length === 0) continue;
    nonEmptyLines += 1;

    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      // この行が壊れている（読み込み境界での途中切れも含む）だけ。ファイル全体は諦めない。
      continue;
    }
    parsedLines += 1;
    applyClaudeRow(preview, row);
  }

  // 1行も解釈できなかった場合はファイルが壊れているとみなし、呼び出し側に伝える。
  // ここで黙って空のプレビューを返すと、壊れたセッションが「中身の無い正常なセッション」と
  // 区別できなくなる（壊れたエントリを隠さないことが設計方針）。
  if (nonEmptyLines > 0 && parsedLines === 0) {
    throw new Error('JSONL として解釈できる行が1行もありません');
  }

  return preview;
}

function allPreviewFieldsFound(preview: ClaudePreview): boolean {
  return (
    preview.title !== undefined &&
    preview.firstPrompt !== undefined &&
    preview.cwd !== undefined &&
    preview.gitBranch !== undefined
  );
}

/** 1行分の JSON（型不明）を防御的に読み、わかるフィールドだけ preview に反映する。 */
function applyClaudeRow(preview: ClaudePreview, row: unknown): void {
  if (typeof row !== 'object' || row === null) return;
  const rec = row as Record<string, unknown>;

  if (preview.cwd === undefined && typeof rec.cwd === 'string') {
    preview.cwd = rec.cwd;
  }
  if (preview.gitBranch === undefined && typeof rec.gitBranch === 'string') {
    preview.gitBranch = rec.gitBranch;
  }
  if (preview.title === undefined && rec.type === 'ai-title' && typeof rec.aiTitle === 'string') {
    preview.title = truncateForPreview(rec.aiTitle);
  }
  if (preview.firstPrompt === undefined && rec.type === 'user') {
    const text = extractUserMessageText(rec.message);
    if (text !== undefined) {
      preview.firstPrompt = truncateForPreview(text);
    }
  }
}

/**
 * `message.content` からプレーンテキストを取り出す。
 * 実データでは文字列の場合と、{type, ...} の混在配列（text / thinking / tool_use / tool_result / image）
 * の場合の両方が観測されているため、両方に対応する。
 */
function extractUserMessageText(message: unknown): string | undefined {
  if (typeof message !== 'object' || message === null) return undefined;
  const content = (message as Record<string, unknown>).content;

  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    for (const item of content) {
      if (typeof item !== 'object' || item === null) continue;
      const part = item as Record<string, unknown>;
      if (part.type === 'text' && typeof part.text === 'string') {
        return part.text;
      }
    }
  }

  return undefined;
}

/**
 * ファイル先頭から最大 maxBytes バイトだけを読む。
 * セッションログは巨大（実測で単一行が数 MB になるケースあり）になりうるため、
 * ファイル全体を readFile することは絶対にしない。
 */
async function readPrefix(filePath: string, maxBytes: number): Promise<string> {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.toString('utf8', 0, bytesRead);
  } finally {
    await handle.close();
  }
}

// ---------------------------------------------------------------------------
// Gemini: `gemini --list-sessions` のテキスト出力をパースする
// ---------------------------------------------------------------------------
//
// 実機（Gemini CLI v0.37.0）で `gemini --list-sessions` を実行して確認した出力形式:
//
//   セッションが無い場合:
//     "No previous sessions found for this project."
//
//   セッションがある場合:
//     "Available sessions for this project (2):"
//     "  1. <タイトル/冒頭プロンプト> (<相対時刻>) [<内部UUID>]"
//     "  2. ..."
//
// JSON 出力ではなくテキスト出力。`-o json` を付けても --list-sessions の出力形式は変わらない。
// resume は `--resume <index>` のように行頭の番号（1始まり）で指定する index ベースの
// インターフェースなので、SessionHistoryEntry.sessionId にはこの index 文字列を入れる
// （末尾の [UUID] は表示上の内部識別子であり、resume にはそのまま使えない）。

const GEMINI_BIN = 'gemini';
/** ハングした CLI にフリーズを引きずられないためのタイムアウト。 */
const GEMINI_EXEC_TIMEOUT_MS = 5000;

const GEMINI_NO_SESSIONS_RE = /no previous sessions/i;
// 例: "  1. reply with just the word: pong (1 minute ago) [043d0e46-...]"
// 行末の [UUID] はタイトル上書きの保存キー（stableId）に使うためキャプチャする。
const GEMINI_LINE_RE = /^\s*(\d+)\.\s+(.*)\s\(([^)]*)\)\s\[([0-9a-fA-F-]+)\]\s*$/;

async function listGeminiHistory(req: ListHistoryRequest): Promise<ListHistoryResult> {
  const limit = normalizeLimit(req.limit);

  let stdout: string;
  try {
    const result = await execFileAsync(GEMINI_BIN, ['--list-sessions'], {
      cwd: req.cwd,
      timeout: GEMINI_EXEC_TIMEOUT_MS,
      windowsHide: true,
    });
    stdout = result.stdout;
  } catch (err) {
    return { entries: [], error: describeGeminiExecError(err) };
  }

  return parseGeminiListSessions(stdout, limit);
}

function parseGeminiListSessions(stdout: string, limit: number): ListHistoryResult {
  const trimmed = stdout.trim();
  if (trimmed.length === 0 || GEMINI_NO_SESSIONS_RE.test(trimmed)) {
    return { entries: [] };
  }

  const entries: SessionHistoryEntry[] = [];
  for (const line of trimmed.split('\n')) {
    const match = GEMINI_LINE_RE.exec(line);
    if (!match) continue; // ヘッダ行（"Available sessions..."）等は無視する
    const [, index, title, relativeTime, uuid] = match;

    entries.push({
      provider: 'gemini',
      sessionId: index,
      updatedAt: approximateEpochFromRelativeTime(relativeTime) ?? Date.now(),
      title: truncateForPreview(title),
      // 行末の内部 UUID。resume には使えないが、タイトル上書きの保存キーには使える。
      stableId: uuid,
    });

    if (entries.length >= limit) break;
  }

  if (entries.length === 0) {
    // ヘッダはあるのに1行もマッチしなかった = 出力フォーマットが変わった可能性が高い。
    return {
      entries: [],
      error: 'gemini --list-sessions の出力を解析できませんでした（フォーマットが変わった可能性）',
    };
  }

  return { entries };
}

/**
 * "Just now" / "5 minutes ago" / "Yesterday" のような相対時刻表現を、
 * 大まかな epoch ミリ秒に変換する。正確な時刻は取得できないため、あくまで近似値。
 * 認識できない表現は undefined を返し、呼び出し側で Date.now() にフォールバックする。
 */
function approximateEpochFromRelativeTime(text: string): number | undefined {
  const normalized = text.trim().toLowerCase();
  const now = Date.now();

  if (normalized === 'just now') return now;
  if (normalized === 'yesterday') return now - 24 * 60 * 60 * 1000;

  const match = /^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/.exec(normalized);
  if (!match) return undefined;

  const amount = Number(match[1]);
  const unitMs: Record<string, number> = {
    second: 1000,
    minute: 60 * 1000,
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
    year: 365 * 24 * 60 * 60 * 1000,
  };
  const unitMsValue = unitMs[match[2]];
  if (unitMsValue === undefined || !Number.isFinite(amount)) return undefined;

  return now - amount * unitMsValue;
}

function describeGeminiExecError(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as NodeJS.ErrnoException & { killed?: boolean; stderr?: string };

    if (e.code === 'ENOENT') {
      return 'gemini コマンドが見つかりません（PATH を確認してください）';
    }
    if (e.killed) {
      return `gemini --list-sessions の実行がタイムアウトしました（${GEMINI_EXEC_TIMEOUT_MS}ms）`;
    }
    const stderrSnippet =
      typeof e.stderr === 'string' && e.stderr.trim().length > 0
        ? `: ${e.stderr.trim().slice(0, 200)}`
        : '';
    const message = e.message ?? '不明なエラー';
    return `gemini --list-sessions の実行に失敗しました（${message}）${stderrSnippet}`;
  }
  return 'gemini --list-sessions の実行に失敗しました（不明なエラー）';
}

// ---------------------------------------------------------------------------
// IPC ハンドラ登録
// ---------------------------------------------------------------------------

function isHistoryProvider(value: unknown): value is HistoryProvider {
  return value === 'claude' || value === 'gemini';
}

/**
 * 履歴関連の IPC ハンドラを登録する。
 * Renderer からの入力は型定義上 ListHistoryRequest だが、IPC 境界を越えた値を
 * 完全には信用せず、provider / cwd の形が想定外でも例外を投げずに error を返す。
 */
export function registerHistoryHandlers(): void {
  ipcMain.handle(
    IpcInvoke.historyList,
    async (_event, req: ListHistoryRequest): Promise<ListHistoryResult> => {
      if (!isHistoryProvider(req?.provider) || typeof req?.cwd !== 'string') {
        return { entries: [], error: '不正な履歴取得リクエストです' };
      }

      try {
        const result =
          req.provider === 'claude'
            ? req.allFolders
              ? await listAllClaudeHistory(normalizeLimit(req.limit))
              : await listClaudeHistory(req)
            : await listGeminiHistory(req);
        return { ...result, entries: result.entries.map((entry) => applyTitleOverride(entry)) };
      } catch (err) {
        // listClaudeHistory / listGeminiHistory は例外を投げない設計だが、念のための最終防衛ライン。
        const message = err instanceof Error ? err.message : '不明なエラー';
        return { entries: [], error: `履歴一覧の取得に失敗しました（${message}）` };
      }
    },
  );
}

/** stableId に対する上書きタイトルがあれば title を差し替える。 */
function applyTitleOverride(entry: SessionHistoryEntry): SessionHistoryEntry {
  if (entry.stableId === undefined) return entry;
  const override = getTitleOverride(entry.provider, entry.stableId);
  if (override === undefined) return entry;
  return { ...entry, title: override };
}
