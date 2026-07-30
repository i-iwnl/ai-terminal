// claude / gemini タブの既定タイトルを決める（純粋関数）。useTabs.ts から
// 切り出してある。useTabs.ts は window.api（preload の型）に依存する他のコードを
// 大量に抱えており、そのまま test/unit/ からインポートすると
// tsconfig.test.json（global.d.ts の window.api 拡張を含まない）で型エラーになる。
// この関数自体は window に一切触れない純粋関数なので、単体テストから安全に
// インポートできるようここへ分離した。
//
// Issue #20 C: 既定が `kind` 固定（`claude` / `gemini`）のままだと、3リポジトリで
// claude を起動しても `claude` `claude` `claude` としか並ばず区別が付かない。
// タブ幅は最大 180px あるのに情報量ゼロなので、cwd の basename を使う。

import { basename } from '../lib/format';

/**
 * 明示的なタイトル（`opts.title`。履歴からの再開など）が最優先で、
 * 次に再開（`isResume`）なら `${kind} (再開)` を保つ（明示タイトルが無い再開は
 * 現状 resumeHistory 経由では発生しないが、意味が分かる文言を残す）。
 * どちらでもなければ basename(cwd) にする。cwd が未解決なら basename() 自体が
 * `(不明)` に縮退する（鉄則5）。
 */
export function resolveAgentTabTitle(
  kind: 'claude' | 'gemini',
  cwd: string | undefined,
  isResume: boolean,
  explicitTitle: string | undefined,
): string {
  if (explicitTitle !== undefined) return explicitTitle;
  if (isResume) return `${kind} (再開)`;
  return basename(cwd);
}
