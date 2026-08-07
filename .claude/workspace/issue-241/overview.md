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
- [x] 周2-a: `taskIdentity.ts` を `src/shared/` へ移し、`TaskList.tsx` の React key を一意にする（中身は1行も変えない）
- [x] 周2-b: `claude.ts` の `parseAgentsJson` を export し、`test/unit/` に新設する（このファイルは単体テストが1本も無い）
- [x] 周2-c: `waitingFor` を `AgentTask` に足し、`claude.ts` でパースする（画面には何も出さない）
- [x] 周2-d: 新規 E2E S106 で `setAgentEntries` に `waiting` を注入し、関門を先に作る（既定フィクスチャは触らない）
- [x] 周2-e: 提案 A（`toTaskState` に `waiting` -> `your-turn`）。S106 が赤から緑になることで担保する
- [x] 周2-f: 通知タイトルを `waitingFor` で出し分ける（OS 通知と Slack / Discord の両方が直る）
- [x] 周2-g: `waitingFor` を行の `aria-label` に足す（視覚配置は次周。5人の対案が割れたため）
- [x] 型チェック通過（`make check`）
- [x] Lintチェック通過（`make check`）

---

## 3. 現状進捗

| 項目 | 状態 |
|---|---|
| 設計 | 完了 |
| 実装 | 完了（周1 + 周2） |
| 検証 | 完了（make check 825 green / make e2e 0 failed / S106 を5通りの壊し方で赤にして確認 / 実機） |

---

## 4. 直近の次アクション

| 優先度 | アクション | 詳細 |
|---|---|---|
| **P0** | `waitingFor` の視覚配置の再検討 | 実機で**待ち行だけメタ行が2行になり、行高が 55px -> 73px**（実測）。1週間使ってから判断する |
| P1 | `known-issues.md` の6番（レビューが見つけた Issue 外の課題9件） | 起票しない。周を増やすかは人が決める |
