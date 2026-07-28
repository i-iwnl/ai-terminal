// 通知音の一覧と再生（macOS）。
//
// Electron の Notification にも sound オプションはあるが、
// 「設定画面で試聴する」「通知を出さずに鳴らす」ができないため、
// 音は自前で afplay に流し、Notification 側は常に silent にする
// （両方が鳴ると二重に聞こえるため。index.ts のコメントも参照）。
//
// macOS 以外では音源の置き場も再生コマンドも異なるため、一覧は空・再生は無音で
// 縮退する。このアプリは macOS 向けだが、Docker での検証時にここで落ちないようにする。

import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';

import type { SoundOption } from '@shared/ipc';

/** macOS のシステムサウンドと、ユーザーが自分で置いたサウンドの探索先。 */
const SOUND_DIRS = [join(homedir(), 'Library', 'Sounds'), '/System/Library/Sounds'];

/** afplay が扱える拡張子だけを一覧に出す。 */
const SOUND_EXTENSIONS = new Set(['.aiff', '.aif', '.wav', '.m4a', '.mp3', '.caf']);

/** 「OS 既定の通知音に任せる」を表す識別子。AppConfig.notifySoundId の既定値。 */
export const DEFAULT_SOUND_ID = '';

/**
 * サウンド識別子を、存在確認にかける候補パスの列に展開する（純粋関数）。
 *
 * - 空文字（既定）: 候補なし（自前では鳴らさず OS に任せる）
 * - '/' 始まり: ユーザー指定の絶対パスとしてそのまま使う（1件だけ）
 * - それ以外: 音源名とみなし、探索先ディレクトリ × 拡張子の総当たり
 *
 * ファイルの存在は見ない。「どこを・どの順で探すか」という規則だけをここに置き、
 * fs に触る部分と分けてある（規則そのものは test/unit/sound.test.ts が固定する）。
 */
export function soundCandidatePaths(
  soundId: string,
  dirs: readonly string[] = SOUND_DIRS,
): string[] {
  if (soundId === DEFAULT_SOUND_ID) return [];
  if (soundId.startsWith('/')) return [soundId];

  const candidates: string[] = [];
  for (const dir of dirs) {
    for (const ext of SOUND_EXTENSIONS) {
      candidates.push(join(dir, `${soundId}${ext}`));
    }
  }
  return candidates;
}

/**
 * ディレクトリの中身（ファイル名の列）を、一覧に出す音源名へ畳む（純粋関数）。
 * 扱えない拡張子を落とし、拡張子を外し、重複を除いて昇順に並べる。
 */
export function toSoundNames(files: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const file of files) {
    const ext = extname(file);
    if (!SOUND_EXTENSIONS.has(ext.toLowerCase())) continue;
    seen.add(basename(file, ext));
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/**
 * サウンド識別子を再生可能な絶対パスに解決する。
 *
 * 存在しないファイルは undefined を返す。設定に古い音源名が残っていても
 * 「鳴らない」だけで済ませ、例外にしない。
 */
export function resolveSoundPath(soundId: string): string | undefined {
  return soundCandidatePaths(soundId).find((candidate) => existsSync(candidate));
}

/**
 * 選択できる通知音の一覧を返す。
 * 先頭は必ず「OS 既定」（id は空文字）。以降は音源名の昇順で重複を除く。
 */
export function listSounds(): SoundOption[] {
  const options: SoundOption[] = [{ id: DEFAULT_SOUND_ID, label: 'OS 既定' }];
  if (process.platform !== 'darwin') return options;

  const files: string[] = [];
  for (const dir of SOUND_DIRS) {
    try {
      files.push(...readdirSync(dir));
    } catch {
      // 存在しないディレクトリ（~/Library/Sounds が無い等）は黙って飛ばす
    }
  }

  for (const name of toSoundNames(files)) {
    options.push({ id: name, label: name });
  }
  return options;
}

/**
 * 通知音を鳴らす。
 *
 * 再生は投げっぱなしにする（完了を待たない）。afplay が無い・音源が壊れている等で
 * 失敗しても、通知そのものは既に出ているのでアプリ側では何もしない。
 */
export function playSound(soundId: string): void {
  if (process.platform !== 'darwin') return;
  const path = resolveSoundPath(soundId);
  if (!path) return;

  try {
    const child = spawn('afplay', [path], { stdio: 'ignore', detached: false });
    // spawn 後のエラー（afplay が無い等）は 'error' イベントで来る。
    // ハンドラを付けないと Electron の Main プロセスごと落ちるので必ず付ける。
    child.on('error', (err) => {
      console.warn('[notify/sound] 再生に失敗しました:', err);
    });
  } catch (err) {
    console.warn('[notify/sound] 再生の起動に失敗しました:', err);
  }
}
