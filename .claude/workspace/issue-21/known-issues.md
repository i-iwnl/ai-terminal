# Known Issues

実装中に発見された未解決のバグ・先送りした課題。
詳細な観察記録は `worklog.md` を参照。

---

## 1. 未知の status について、UI と通知ロジックの判断が食い違う

### 症状

この Issue で UI は `busy` / `idle` / それ以外（不明）の3値に分けるが、`src/main/agents/poller.ts:157` の通知は
`busy` 以外をすべて「作業完了」として扱う二値のまま。

CLI が `waiting_for_input` のような第3の値を返し始めると、**UI は「不明」と表示し、通知は「作業が完了しました」と言う**。

### 原因（判明している場合）

`AgentTask.status` が `string | undefined`（CLI が返した値をそのまま持つ）であるのに対し、
表示側と通知側がそれぞれ独立に「既知の値」を仮定している。既知の値の集合が1箇所に定義されていない。

### 影響範囲

- `src/renderer/src/sidebar/TaskList.tsx`（表示）
- `src/main/agents/poller.ts`（OS 通知・Slack / Discord 転送）
- 将来 Dock バッジを実装する [#24](https://github.com/i-iwnl/ai-terminal/issues/24) も同じ判定を必要とする

### 対処方針

- [ ] 既知の status とその意味を1箇所（`src/shared/` 想定）に定義し、UI と poller の両方がそこを参照する
- [ ] #24（Dock バッジ）の実装時に同じ判定が3箇所目にならないよう、着手前にこの共通化を通す

### 優先度

P2

### ステータス

未対処（この Issue のスコープ外。現時点では CLI が `busy` / `idle` しか返さないため実害は出ていない）

---

## 2. 掲載スクリーンショットの中身が古いことを機械で検出できない

### 症状

`docs/images/*.png` は `scripts/lint-e2e.mjs` の check9 で**ファイルの存在だけ**が検査される。
中身が実装と食い違っていても FAIL しない。今回の誤ったキャプションが焼き込まれた画像も、この隙間で残り続けていた。

### 原因（判明している場合）

`make e2e-lint` は `e2e/screenshots.spec.ts` 自体を検査対象に含めていない（`scripts/lint-e2e.mjs` を参照）。
撮影スクリプトの中身と台帳の対応が見られていない。

### 影響範囲

- `docs/images/` 配下すべて
- README の説明の正しさ

### 対処方針

- [ ] 撮影後の画像の mtime が spec の mtime より古い場合に WARN を出す、程度の緩い検査を検討する
- [ ] 実施するかは #20 の Phase が進み、撮り直しの頻度が上がってから判断する

### 優先度

P3

### ステータス

未対処（先送り）

---
