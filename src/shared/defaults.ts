/**
 * 設定の既定値。**このファイルが唯一の正。**
 *
 * 以前は Main（`src/main/config.ts`）と Renderer（`App.tsx`）に同じ値が手で書かれており、
 * 「揃えてある」というコメントだけで守られていた。設定を1つ足すたびに両方へ書く必要があり、
 * 片方を忘れると「設定の取得に失敗したときだけ挙動が変わる」という再現しにくい形で表に出る。
 *
 * `src/shared/` は electron.vite.config.ts の sharedAlias で main / preload / renderer の
 * すべてから参照できるので、ここに置けば3プロセスが同じ値を見る。
 *
 * **設定項目を増やすときは、まず `src/shared/ipc.ts` の AppConfig に足し、次にここへ足す。**
 * 型が通らなくなるので、片方だけ書いて止まることはない。
 */

import type { AppConfig, TerminalTheme, WebhookConfig } from './ipc';

/**
 * 面の色。**CSS の `--surface-*` と同じ値でなければならない。**
 *
 * CSS 変数は Main プロセスから読めないため、この2つは構造的に統一できない。
 * 揃っていることは `test/unit/css-tokens.test.ts` が機械で突き合わせる
 * （「揃えてある」というコメントだけで守るのを、このリポジトリは一度失敗している）。
 *
 * **とくに `base` は、CSS の面と xterm が塗る背景の両方になる。**
 * `.terminal-pane__container` には padding があるので、片方だけ変えると
 * xterm が塗る領域の外周に色の違う帯が出る（Issue #20 の A-2）。
 */
export const SURFACE = {
  /** サイドバー（最奥）。CSS の --surface-0 */
  sidebar: '#141414',
  /** ターミナル背景・ウィンドウ既定。CSS の --surface-1 */
  base: '#1e1e1e',
  /** 行のホバー。CSS の --surface-2 */
  hover: '#222222',
  /** 設定ウィンドウ・浮いた面（最前）。CSS の --surface-3 */
  raised: '#282828',
} as const;

export const DEFAULT_THEME: TerminalTheme = {
  background: SURFACE.base,
  foreground: '#d4d4d4',
  cursor: '#d4d4d4',
  selectionBackground: '#264f78',
};

export const DEFAULT_WEBHOOK: WebhookConfig = {
  enabled: false,
  url: '',
};

export const DEFAULT_CONFIG: AppConfig = {
  // shell は未指定なら $SHELL、それも無ければ /bin/zsh を使う（解決は pty 側の責務）
  shell: undefined,
  // Issue #20 H: ui-monospace を先頭にする（macOS 上で SF Mono に解決される
  // CSS 汎用ファミリ）。Menlo は環境が古く ui-monospace を解決できない場合の
  // フォールバックとして残す。
  fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
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
  // 既定で有効にしない理由は描画コスト。VoiceOver を検知したときは設定に関わらず有効になる。
  screenReaderMode: false,
  theme: DEFAULT_THEME,
};
