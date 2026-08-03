// 設定（config.json）の読み書き。保存先の決定は data-dir.ts が正
// （dev 起動は ~/.ai-terminal-dev、安定版は ~/.ai-terminal）。
//
// このモジュールは Main プロセスの他モジュール（pty / agents / notify）から
// getConfig() で参照される共有モジュール。壊すと全体に波及するので変更は慎重に。

import { BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import {
  IpcEvent,
  IpcInvoke,
  type AppConfig,
  type TerminalTheme,
  type WebhookConfig,
} from '@shared/ipc';
// 既定値の唯一の正。Renderer 側の初期値も同じものを見る。
import { DEFAULT_CONFIG, DEFAULT_THEME, DEFAULT_WEBHOOK } from '@shared/defaults';
// 保存先の決定は data-dir.ts に集約する（dev と安定版で別ディレクトリになる）。
import { dataDir } from './data-dir';

const CONFIG_DIR = dataDir();
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

let cached: AppConfig | null = null;

/**
 * 外部 JSON を安全に AppConfig へ寄せる。
 * 型が合わないフィールドは黙って捨て、デフォルト値を使う。
 * 設定ファイルが壊れていてもアプリを落とさないことを優先する。
 *
 * ファイル I/O を伴わない純粋関数なので、単体テストの対象として export している。
 */
export function coerceConfig(raw: unknown): AppConfig {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_CONFIG };
  const src = raw as Record<string, unknown>;

  const str = (key: string, fallback: string): string =>
    typeof src[key] === 'string' ? (src[key] as string) : fallback;
  const num = (key: string, fallback: number): number =>
    typeof src[key] === 'number' && Number.isFinite(src[key]) ? (src[key] as number) : fallback;
  const bool = (key: string, fallback: boolean): boolean =>
    typeof src[key] === 'boolean' ? (src[key] as boolean) : fallback;

  const rawTheme =
    typeof src.theme === 'object' && src.theme !== null
      ? (src.theme as Record<string, unknown>)
      : {};
  const themeStr = (key: keyof TerminalTheme): string =>
    typeof rawTheme[key] === 'string' ? (rawTheme[key] as string) : DEFAULT_THEME[key];

  // Webhook は { enabled, url } の入れ子。設定ファイルが古くて丸ごと欠けていても
  // 既定値（無効・URL 空）へ寄せる。
  const webhook = (key: 'slack' | 'discord'): WebhookConfig => {
    const raw =
      typeof src[key] === 'object' && src[key] !== null
        ? (src[key] as Record<string, unknown>)
        : {};
    return {
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_WEBHOOK.enabled,
      url: typeof raw.url === 'string' ? raw.url : DEFAULT_WEBHOOK.url,
    };
  };

  return {
    shell: typeof src.shell === 'string' ? src.shell : undefined,
    fontFamily: str('fontFamily', DEFAULT_CONFIG.fontFamily),
    // 極端な値でレイアウトが壊れないよう範囲を制限する
    fontSize: Math.min(48, Math.max(6, num('fontSize', DEFAULT_CONFIG.fontSize))),
    pollIntervalMs: Math.max(500, num('pollIntervalMs', DEFAULT_CONFIG.pollIntervalMs)),
    useTmux: bool('useTmux', DEFAULT_CONFIG.useTmux),
    notifyOnIdle: bool('notifyOnIdle', DEFAULT_CONFIG.notifyOnIdle),
    notifySound: bool('notifySound', DEFAULT_CONFIG.notifySound),
    notifySoundId: str('notifySoundId', DEFAULT_CONFIG.notifySoundId),
    slack: webhook('slack'),
    discord: webhook('discord'),
    scopeAgentsToCwd: bool('scopeAgentsToCwd', DEFAULT_CONFIG.scopeAgentsToCwd),
    // 範囲の判定そのものは Renderer 側の clampSidebarWidth が正（ドラッグ中も
    // 同じ関数を通す）。ここでは「数値でなければ既定へ落とす」だけに留め、
    // 上下限をもう1箇所に書き写さない（二重管理を作らない）。
    sidebarWidth: num('sidebarWidth', DEFAULT_CONFIG.sidebarWidth),
    screenReaderMode: bool('screenReaderMode', DEFAULT_CONFIG.screenReaderMode),
    // 未知の名前でも落とさない（鉄則5）。プリセットに無ければ
    // themes.ts の resolveTheme が保存済みの theme へ縮退する。
    themeName: str('themeName', DEFAULT_CONFIG.themeName),
    theme: {
      background: themeStr('background'),
      foreground: themeStr('foreground'),
      cursor: themeStr('cursor'),
      selectionBackground: themeStr('selectionBackground'),
    },
  };
}

/** 設定を取得する。初回はファイルから読み、以降はキャッシュを返す。 */
export function getConfig(): AppConfig {
  if (cached) return cached;
  try {
    const text = readFileSync(CONFIG_PATH, 'utf8');
    cached = coerceConfig(JSON.parse(text) as unknown);
  } catch {
    // 未作成・パース失敗ともデフォルトで縮退する
    cached = { ...DEFAULT_CONFIG };
  }
  return cached;
}

/** 設定を部分更新して保存する。保存に失敗してもメモリ上の値は更新する。 */
export function setConfig(patch: Partial<AppConfig>): AppConfig {
  const next = coerceConfig({ ...getConfig(), ...patch });
  cached = next;
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  } catch (err) {
    console.error('[config] 保存に失敗しました:', err);
  }
  return next;
}

export function registerConfigHandlers(): void {
  ipcMain.handle(IpcInvoke.configGet, (): AppConfig => getConfig());
  ipcMain.handle(IpcInvoke.configSet, (_event, patch: Partial<AppConfig>): AppConfig => {
    const next = setConfig(patch ?? {});
    broadcastConfig(next);
    return next;
  });
}

/**
 * 設定の変更を全ウィンドウへ配信する。
 *
 * 設定ウィンドウは本体とは別の Renderer なので、そこでの変更は本体の state には
 * 届かない（モーダルだった頃は同じ Renderer だったので不要だった）。
 * **配信を忘れると「設定を変えてもターミナルに反映されない」という形で表に出る。**
 */
function broadcastConfig(config: AppConfig): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send(IpcEvent.configChanged, config);
  }
}
