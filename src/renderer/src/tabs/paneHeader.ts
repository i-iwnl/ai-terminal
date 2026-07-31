// ペインヘッダ（Issue #56 design-review.md 提案 G）に出す文字列を組み立てる純粋関数。
//
// 分割中のみ、各ペインの上に高さ18pxのヘッダを出す。「zsh / claude /
// claude (再開)」+ cwd の basename、が design-review.md の指定。
//
// **`leaf.title` は使わない。** `tabTitle.ts` の `resolveAgentTabTitle` が
// 決める `title` はタブバーに出す「タブの見出し」で、既定値が `basename(cwd)`
// だったり（非再開のエージェントタブ・シェルタブ）、履歴からの再開では
// 履歴一覧の表示名がそのまま入っていたりと、用途がここと異なる
// （ユーザーが `renameTab` で書き換えることもある）。ペインヘッダは
// 「このペインで何が動いているか」という機能の説明を常に一定の形で出す
// 必要があるため、`ptyKind` / `isResume` / `cwd` から独立に組み立てる。
//
// 語を必ず併記する（design-rules.md 原則2）。TerminalPane.tsx がこの文字列を
// ヘッダの表示テキストと aria-label の両方に使うため、視覚と読み上げが
// 常に一致する（片方だけ更新して食い違う事故を構造的に防ぐ）。

import { basename } from '../lib/format';
import type { PaneLeaf } from './paneTree';

const PTY_KIND_LABEL: Record<PaneLeaf['ptyKind'], string> = {
  shell: 'zsh',
  claude: 'claude',
  gemini: 'gemini',
};

/** その leaf を説明する文字列（例: `claude・my-repo` / `zsh・(不明)`）。 */
export function paneHeaderLabel(leaf: PaneLeaf): string {
  const kind = PTY_KIND_LABEL[leaf.ptyKind];
  const kindLabel = leaf.isResume ? `${kind} (再開)` : kind;
  return `${kindLabel}・${basename(leaf.cwd)}`;
}
