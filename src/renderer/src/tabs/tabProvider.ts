// タブのプロバイダ（claude / gemini / シェル）を人間向けのラベルにする（純粋関数）。
//
// Issue #20 C の指摘（差し戻し）: タブタイトルの既定を basename(cwd) にした結果、
// 同じリポジトリで claude と gemini を1本ずつ開くと両方とも `demo-project` になり、
// プロバイダを見分ける手がかりが画面から消えた。プロバイダはタブ自体の色相
// （TabBar.tsx の `tab-bar__tab--${kind}` クラス、styles.css の
// `--tab-provider-*` トークン）で表すが、**色相だけに頼らない**
//（デザイン原則2: 色覚特性下では色相が消える。PR 8 で初版の提案色が
// 1型色覚下でむしろ悪化した実例がある）。そのためこのラベルを
// `title` 属性のツールチップと role="tab" のアクセシブルネームの両方に使い、
// 色以外の手がかりを必ず添える。
//
// **残る限界**: この文字ラベルは常時可視ではない（ツールチップはホバーで
// 初めて出る、アクセシブルネームは支援技術にしか届かない）。色覚特性を持つ
// 晴眼のユーザーにとっては、ホバーするまでプロバイダを判別する手段が無い。
// 文字マーク（$/C/G 案）とタブ最小幅の拡大はどちらも Issue #20 で却下済みのため、
// この限界は解消できるものではなく、既知の制約として記録する
// （.claude/workspace/issue-20/known-issues.md 参照）。

import type { PtyKind } from '@shared/ipc';

/** タブのプロバイダ種別を、ツールチップ・アクセシブルネームに使う表記にする。 */
export function providerLabel(kind: PtyKind): string {
  switch (kind) {
    case 'claude':
      return 'Claude';
    case 'gemini':
      return 'Gemini';
    case 'shell':
      return 'シェル';
  }
}
