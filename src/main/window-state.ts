// ウィンドウの位置・サイズ・フルスクリーン状態の永続化（Issue #119 周5 / #20 の K-9）。
//
// **`config.json`（AppConfig）には入れない。** 理由が3つある。
//
//   1. `config.ts` の `setConfig` は**全ウィンドウへブロードキャスト**し、その先で
//      `coerceConfig` が毎回新しい `theme` を組み立てるため、`App.tsx` の
//      `useEffect([config.theme])` を経由して**全ペインの `term.options.theme` が
//      再代入される**。ウィンドウを掴んで動かすたびにこれが走るのは重すぎる
//   2. `setConfig` は毎回 `JSON.stringify(next)` で設定ファイルを全書き換えする。
//      resize / move は連続イベントなので、そのたびにディスクを叩くことになる
//   3. 設定 UI に出さない項目を `AppConfig` に足すと、`S70-settings-labels-contract`
//      が固定している「設定ウィンドウの情報設計」と型がずれる
//
// `memo/store.ts` と `history/titles.ts` が同じ形（Main 内で完結する別ファイル）の
// 前例で、実装パターンもそれらに揃えてある。**`src/shared/ipc.ts` にも preload にも
// 1行も足さない**（Renderer はこの値を読まない）。
//
// **選択中のタブは復元しない。** PTY を作り直すことになり、tmux の永続化
// （#15）と絡んで別の設計判断が要る。ここで復元するのは「ウィンドウを置き直す手数」
// だけ（1日3〜5回の起動 × 2〜4手）。

import { screen, type BrowserWindow, type Rectangle } from 'electron';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { dataDir } from './data-dir';

const STATE_PATH = join(dataDir(), 'window-state.json');

/** 既定のウィンドウサイズ。**復元できないときの縮退先。** */
export const DEFAULT_WINDOW_SIZE = { width: 1200, height: 800 } as const;

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  fullScreen: boolean;
}

const DEFAULT_STATE: WindowState = {
  width: DEFAULT_WINDOW_SIZE.width,
  height: DEFAULT_WINDOW_SIZE.height,
  fullScreen: false,
};

/**
 * 外部 JSON を安全に `WindowState` へ寄せる。
 * 壊れていてもアプリを落とさない（CLAUDE.md 鉄則5）。
 */
export function coerceWindowState(raw: unknown): WindowState {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_STATE };
  const src = raw as Record<string, unknown>;
  const num = (key: string): number | undefined =>
    typeof src[key] === 'number' && Number.isFinite(src[key]) ? (src[key] as number) : undefined;

  return {
    x: num('x'),
    y: num('y'),
    // 幅・高さは BrowserWindow の minWidth / minHeight を下回らせない。
    // 下回ると「開いた瞬間に何も操作できないウィンドウ」になる。
    width: Math.max(640, num('width') ?? DEFAULT_STATE.width),
    height: Math.max(400, num('height') ?? DEFAULT_STATE.height),
    fullScreen: typeof src.fullScreen === 'boolean' ? src.fullScreen : false,
  };
}

/**
 * 保存された矩形が、いまつながっているディスプレイのどれかと重なっているか。
 *
 * **外部ディスプレイを外したあとに起動すると、ウィンドウが画面外に出て
 * 二度と掴めなくなる。** 位置だけ捨てて既定の中央配置へ落とす
 * （サイズとフルスクリーン状態は活かす）。
 */
export function isVisibleOnSomeDisplay(
  state: WindowState,
  displays: ReadonlyArray<{ bounds: Rectangle }>,
): boolean {
  if (state.x === undefined || state.y === undefined) return false;
  const { x, y, width, height } = state;
  return displays.some(({ bounds }) => {
    const overlapX = Math.min(x + width, bounds.x + bounds.width) - Math.max(x, bounds.x);
    const overlapY = Math.min(y + height, bounds.y + bounds.height) - Math.max(y, bounds.y);
    // タイトルバーを掴める程度に重なっていれば「見えている」とみなす。
    return overlapX > 100 && overlapY > 50;
  });
}

export function readWindowState(): WindowState {
  try {
    return coerceWindowState(JSON.parse(readFileSync(STATE_PATH, 'utf8')) as unknown);
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function write(state: WindowState): void {
  try {
    mkdirSync(dataDir(), { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
  } catch {
    // 保存できなくても起動と操作は続けられる（次回起動で既定に戻るだけ）。
  }
}

/**
 * 起動時に使う `BrowserWindow` のオプション断片。
 *
 * 位置が現在のディスプレイ構成で見えない場合は `x` / `y` を落とす
 * （Electron が中央に配置する）。
 */
export function windowStateOptions(): {
  x?: number;
  y?: number;
  width: number;
  height: number;
} {
  const state = readWindowState();
  const displays = screen.getAllDisplays();
  if (!isVisibleOnSomeDisplay(state, displays)) {
    return { width: state.width, height: state.height };
  }
  return { x: state.x, y: state.y, width: state.width, height: state.height };
}

/**
 * ウィンドウの状態変化を購読して保存する。
 *
 * **`resize` / `move` は連続で飛ぶのでデバウンスする。** ドラッグ中に
 * 毎フレーム `writeFileSync` すると、そのままディスクを叩き続けることになる
 * （`SidebarResizeHandle` がドラッグ中に `configSet` を呼ばないのと同じ理由）。
 */
export function trackWindowState(win: BrowserWindow): void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const save = (): void => {
    if (win.isDestroyed()) return;
    // **フルスクリーン中の bounds は画面いっぱいの値**なので保存しない
    // （解除したときに元の大きさへ戻れなくなる）。`getNormalBounds()` は
    // 最大化・フルスクリーン前の矩形を返す。
    const bounds = win.getNormalBounds();
    write({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      fullScreen: win.isFullScreen(),
    });
  };

  const scheduleSave = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      save();
    }, 400);
  };

  win.on('resize', scheduleSave);
  win.on('move', scheduleSave);
  // フルスクリーンの出入りは1回きりのイベントなので、待たずに保存する。
  win.on('enter-full-screen', save);
  win.on('leave-full-screen', save);
  win.on('close', () => {
    if (timer !== null) clearTimeout(timer);
    save();
  });
}

/** 保存されていたフルスクリーン状態を、ウィンドウを見せる前に適用する。 */
export function applyFullScreenState(win: BrowserWindow): void {
  if (readWindowState().fullScreen) win.setFullScreen(true);
}

/** 保存先のパス（テストとトラブルシューティング用）。 */
export function windowStatePath(): string {
  return STATE_PATH;
}
