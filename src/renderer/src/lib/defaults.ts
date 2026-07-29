// window.api.config.get() が失敗しても画面を出すための既定値。
//
// **本体ウィンドウと設定ウィンドウの両方が使う**ため、どちらかに置くと二重化する。
// なお Main 側の src/main/config.ts の DEFAULT_CONFIG とは今も手で揃えている状態で、
// これは #20 の PR 1（src/shared/ へ寄せて単一の正にする）で解消する予定。

import type { AppConfig } from '@shared/ipc';

export const FALLBACK_CONFIG: AppConfig = {
  shell: undefined,
  fontFamily: 'Menlo, "SF Mono", monospace',
  fontSize: 13,
  pollIntervalMs: 3000,
  useTmux: true,
  notifyOnIdle: true,
  notifySound: true,
  notifySoundId: '',
  slack: { enabled: false, url: '' },
  discord: { enabled: false, url: '' },
  scopeAgentsToCwd: false,
  screenReaderMode: false,
  theme: {
    background: '#1e1e1e',
    foreground: '#d4d4d4',
    cursor: '#d4d4d4',
    selectionBackground: '#264f78',
  },
};
