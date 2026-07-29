// アプリ全体のキーボードショートカット判定。
//
// Cmd（metaKey）系の組み合わせだけを対象にする。Ctrl+C など端末本来のキー入力とは
// 絶対に衝突しない設計にするため、ctrlKey / altKey が同時に押されている場合は無視する。
//
// **キーを実際に拾うのはここ1箇所。** メニュー（src/main/menu.ts）は同じキーを
// 表示するだけで登録しない（registerAccelerator: false）。両方が登録すると二重発火する。
// 操作の語彙は src/shared/ipc.ts の AppAction が唯一の正。

import type { AppAction } from '@shared/ipc';

export type ShortcutAction = AppAction;

export function matchShortcut(e: KeyboardEvent): ShortcutAction | null {
  if (!e.metaKey || e.ctrlKey || e.altKey) return null;

  const key = e.key.toLowerCase();

  if (e.shiftKey) {
    // AI CLI の起動は Cmd+Shift 系に置く。
    // Cmd+K は iTerm2 / Terminal.app / Ghostty のいずれでも「画面を消去」で、
    // ここを奪うと**クリアのつもりで押した人が本物の claude を1本余計に起動する**。
    if (key === 'c') return { type: 'new-claude-tab' };
    // gemini は Cmd+Shift+E（g-E-mini の E）。
    //
    // 以前は Cmd+Shift+G だったが、これは Safari / Xcode / TextEdit など macOS 全域で
    // 「前を検索」の標準キーで、検索中に反射で押すと**本物の gemini が1本余計に
    // 起動する**（Issue #62）。Cmd+K を画面消去に残した理由（クリアのつもりで
    // claude を起動させない）とまったく同じ型の事故で、gemini 側だけ見落としていた。
    // Cmd+Shift+G は下で「前を検索」に明け渡し、本来の意味に戻す。
    if (key === 'e') return { type: 'new-gemini-tab' };
    // 前を検索。上の理由により Cmd+Shift+G を gemini の起動から取り戻す。
    if (key === 'g') return { type: 'find-previous' };
    return null;
  }

  if (key === 't') return { type: 'new-shell-tab' };
  if (key === 'w') return { type: 'close-tab' };
  if (key === 'f') return { type: 'toggle-search' };
  // 次を検索。Safari / Xcode / TextEdit と同じ、macOS 全域の「次を検索」キー。
  if (key === 'g') return { type: 'find-next' };
  if (key === 'k') return { type: 'clear-terminal' };
  // Cmd+, は macOS で「アプリの環境設定」の標準ショートカット
  if (key === ',') return { type: 'toggle-settings' };
  if (/^[1-9]$/.test(e.key)) return { type: 'switch-tab', index: Number(e.key) - 1 };

  return null;
}
