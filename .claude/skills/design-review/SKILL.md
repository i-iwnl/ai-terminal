---
name: design-review
description: ai-terminal の UI（サイドバー・タブバー・通知・設定などのクローム）のデザイン案を、5つのペルソナのサブエージェント（macOS プロダクトデザイナー / 初見ユーザー・IA 設計者 / エージェント常用ヘビーユーザー / アクセシビリティ専門家 / 保守担当エンジニア）に並列レビューさせ、指摘を統合して実行可能な案に落とすためのskill。デザイン案のレビュー実施(run-review)、レビュー結果のGitHub Issueへの起票(file-proposal)、UIを書くとき常に守る規約と過去に却下された案の理由(reference/design-rules.md)を扱う。「デザインを見直したい」「UIの見た目を変えたい」「配色・コントラスト・トークンを決めたい」「デザイン案をレビューして」「ペルソナレビューして」「アクセシビリティを確認して」「この画面は初見で分かるか」といった依頼で使う。実装ループ本体は/workspace-plan loopが担い、本skillはその中の「見た目を変える周」でだけ差し込まれる。
---

# design-review

UI の見た目を変える作業に、**多角的なレビューを機械的に差し込むための skill。**

1人で書いたデザイン案は、書いた本人の視点しか持たない。実際にこの skill の元になったレビューでは、
案そのものより先に「**デザイン以前に壊れているもの**」が5件見つかり、案の中核的な前提が2つ覆った。
**レビューの価値は案を磨くことではなく、案の前提を壊すことにある。**

## どれを読むか

| やること | 読むドキュメント |
|---|---|
| デザイン案を5ペルソナにレビューさせ、指摘を統合する | [operations/run-review.md](operations/run-review.md) |
| レビュー結果を GitHub Issue に起票する（親 / 子の切り分け） | [operations/file-proposal.md](operations/file-proposal.md) |
| UI を書くとき常に守る規約・閾値・却下済みの案とその理由 | [reference/design-rules.md](reference/design-rules.md) |
| 各ペルソナが何を担当し、何を調べるか | `.claude/agents/design-reviewer-*.md`（5体） |

## いつ起動するか

`/workspace-plan loop` の **1（計画）ゲートで、その周が「見た目を変える周」なら起動する。**
判定は次のいずれかに該当するか:

- `src/renderer/src/styles.css` を触る
- 画面に出る文言・ラベル・空状態を変える
- サイドバー・タブバー・通知・設定パネルの構造を変える
- 状態（実行中 / 待ち など）の見せ方を変える

**該当しない周では起動しない。** ロジックだけの修正にペルソナレビューを回すのは無駄。

## 絶対に守ること

- **レビューは読み取り専用。** 5体のサブエージェントはリポジトリのファイルを編集しない（各 agent 定義の自己検証チェックリストで担保）
- **レビュー結果をそのまま案にしない。** 5人の指摘は互いに矛盾する。統合はメインの仕事で、[run-review.md](operations/run-review.md) の収束手順が唯一の正
- **却下された案を再提案しない。** 却下理由は [reference/design-rules.md](reference/design-rules.md) に残してある
- 検証コマンドは再掲しない。唯一の正はルート [CLAUDE.md](../../../CLAUDE.md)

## 関連

- 実装を1周回す（この skill はその一部） -> [/workspace-plan](../workspace-plan/SKILL.md)
- 見た目の変更で落ちる E2E とスクリーンショットの撮り直し -> [/e2e](../e2e/SKILL.md)
- 設定項目を増やすときの IPC 契約 -> [/electron-ipc](../electron-ipc/SKILL.md)
- skill 一覧と設計ルールの全体像 -> [.claude/README.md](../../README.md)
