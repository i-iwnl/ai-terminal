// 設定（~/.ai-terminal/config.json）の読み書き。
//
// このモジュールは Main プロセスの他モジュール（pty / agents / notify）から
// getConfig() で参照される共有モジュール。壊すと全体に波及するので変更は慎重に。

import { ipcMain } from 'electron';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { IpcInvoke, type AppConfig, type TerminalTheme, type WebhookConfig } from '@shared/ipc';

const CONFIG_DIR = join(homedir(), '.ai-terminal');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

const DEFAULT_THEME: TerminalTheme = {
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  cursor: '#d4d4d4',
  selectionBackground: '#264f78',
};

const DEFAULT_WEBHOOK: WebhookConfig = {
  enabled: false,
  url: '',
};

export const DEFAULT_CONFIG: AppConfig = {
  // shell は未指定なら $SHELL、それも無ければ /bin/zsh を使う（解決は pty 側の責務）
  shell: undefined,
  fontFamily: 'Menlo, "SF Mono", monospace',
  fontSize: 13,
  pollIntervalMs: 3000,
  useTmux: true,
  notifyOnIdle: true,
  notifySound: true,
  // 空文字は「OS 既定の通知音に任せる」。識別子の意味は notify/sound.ts が正。
  notifySoundId: '',
  slack: DEFAULT_WEBHOOK,
  discord: DEFAULT_WEBHOOK,
  scopeAgentsToCwd: false,
  screenReaderMode: false,
  theme: DEFAULT_THEME,
};

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
    screenReaderMode: bool('screenReaderMode', DEFAULT_CONFIG.screenReaderMode),
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
    return setConfig(patch ?? {});
  });
}
