# Issue #241 作業完了通知が3秒ごとに無限に鳴り続ける（重複 sessionId で完了検知が毎周回発火する） - Overview

> **Issue**: [#241 作業完了通知が3秒ごとに無限に鳴り続ける（重複 sessionId で完了検知が毎周回発火する）](https://github.com/i-iwnl/ai-terminal/issues/241)
>
> `claude agents --json` が同じ `sessionId` の別プロセスを複数返すと、`detectAndNotifyCompletions` の
> sessionId キー Map（後勝ち）が重複行を取り違え、**一覧が1ミリも変わっていないのに毎ポーリングで
> 完了通知が発火する**。CLI が返し始めた未知の `status: "waiting"` が `unknown` へ落ちることで、
> その取り違えが「作業完了」と判定される。
>
> 詳細は以下の3ドキュメントに分割:
>
> - `architecture.md` - 触る構造・Contract変更・設計判断
> - `worklog.md` - 時系列の作業ログ・次に再開するとき最初に読むべきこと
> - `known-issues.md` - 判明した問題・未解決事項・先送りしたもの
>
> **最終更新**: 2026-08-07

---

## 1. ゴール

完了通知の発火判定を「一覧が変わっていなければ何も起きない」性質を持つ形に直し、それを単体テストで固定する。
あわせて CLI が返し始めた `waiting` / `waitingFor` を状態の意味の単一の正（`src/shared/agent-status.ts`）に取り込み、
表示・通知・Dock バッジの3箇所で扱いを一致させる。

| カテゴリ | 対象 |
|---|---|
| 対象トラック | 単一（main: agents / notify + shared: agent-status） |
| ブランチ | `fix/241-notify-loop` |
| 関連PR | 未作成 |

---

## 2. 完成条件

- [x] 周1: 同じ `sessionId` を持つタスクが2件あっても、状態が変わっていなければ通知が0件であることを `test/unit/` で固定する
- [x] 周1: そのテストが修正前のコードで赤くなることを、実際に戻して確認する
- [x] 周1: `detectAndNotifyCompletions` の判定部を純粋関数として切り出し、`poller.ts` は結果を使うだけにする
- [x] 周1: `computeYourTurnSince` も重複 `sessionId` で壊れないことを単体テストで固定する
- [ ] 周2-a: `taskIdentity.ts` を `src/shared/` へ移し、`TaskList.tsx` の React key を一意にする（中身は1行も変えない）
- [ ] 周2-b: `claude.ts` の `parseAgentsJson` を export し、`test/unit/` に新設する（このファイルは単体テストが1本も無い）
- [ ] 周2-c: `waitingFor` を `AgentTask` に足し、`claude.ts` でパースする（画面には何も出さない）
- [ ] 周2-d: 新規 E2E S106 で `setAgentEntries` に `waiting` を注入し、関門を先に作る（既定フィクスチャは触らない）
- [ ] 周2-e: 提案 A（`toTaskState` に `waiting` -> `your-turn`）。S106 が赤から緑になることで担保する
- [ ] 周2-f: 通知タイトルを `waitingFor` で出し分ける（OS 通知と Slack / Discord の両方が直る）
- [ ] 周2-g: `waitingFor` を行の `aria-label` に足す（視覚配置は次周。5人の対案が割れたため）
- [ ] 型チェック通過（`make check`）
- [ ] Lintチェック通過（`make check`）

---

## 3. 現状進捗

| 項目 | 状態 |
|---|---|
| 設計 | 周1 完了 / 周2 は design-review で再計画（7本に分割） |
| 実装 | 周1 完了 |
| 検証 | 周1 完了（make check 803 green・実機で修正前後を同時比較） |

---

## 4. 直近の次アクション

| 優先度 | アクション | 詳細 |
|---|---|---|
| **P0** | 周2-a / 周2-b（依存ゼロ。単独でマージできる） | 移動とテスト追加のみ。値も挙動も1つも変えない |
| P1 | 周2-d -> 周2-e | **関門を先に作ってから意味を変える**（先に赤くなることを確認する） |
| P2 | 周2-c -> 周2-f -> 周2-g | 通知の文言は3人が独立に指摘した「案の前に切り出すべきもの」 |
| P3 | push 前のフル `make e2e` / `make e2e-lint` | **撮影レーンは不要**（既定フィクスチャに `waiting` が無いので画素は動かない。レビューが実測） |
