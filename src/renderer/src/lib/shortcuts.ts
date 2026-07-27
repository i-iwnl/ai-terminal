// アプリ全体のキーボードショートカット判定。
//
// Cmd（metaKey）系の組み合わせだけを対象にする。Ctrl+C など端末本来のキー入力とは
// 絶対に衝突しない設計にするため、ctrlKey / altKey が同時に押されている場合は無視する。

export type ShortcutAction =
  | { type: 'new-shell-tab' }
  | { type: 'close-tab' }
  | { type: 'switch-tab'; index: number }
  | { type: 'new-claude-tab' }
  | { type: 'new-gemini-tab' }
  | { type: 'toggle-search' };

export function matchShortcut(e: KeyboardEvent): ShortcutAction | null {
  if (!e.metaKey || e.ctrlKey || e.altKey) return null;

  const key = e.key.toLowerCase();

  // Cmd+K / Cmd+Shift+K は shift の有無で claude / gemini を分ける
  if (key === 'k') {
    return e.shiftKey ? { type: 'new-gemini-tab' } : { type: 'new-claude-tab' };
  }

  // 以降は shift 併用のショートカットが無いので、shift が押されていたら対象外
  if (e.shiftKey) return null;

  if (key === 't') return { type: 'new-shell-tab' };
  if (key === 'w') return { type: 'close-tab' };
  if (key === 'f') return { type: 'toggle-search' };
  if (/^[1-9]$/.test(e.key)) return { type: 'switch-tab', index: Number(e.key) - 1 };

  return null;
}
