# Known Issues

実装中に発見された未解決のバグ・先送りした課題。
詳細な観察記録は `worklog.md` を参照。

---

## 1. E2E の「検証できない」注記が、解決後も残り続ける

### 症状

制約を書いた spec のコメントが、その制約を解く Issue が closed になっても更新されない。**次に読む人が同じ調査をやり直す。**

実例が2系統ある。

| 箇所 | 書いてあること | 実際 |
|---|---|---|
| `e2e/specs/S68-your-turn-jump-empty.spec.ts` / `S78` / `S63` / `e2e/scenarios.yml` の4箇所 | 「成功経路はハーネスで作れない。解くのは Issue #83 / #120 D-2」 | **#83 は CLOSED**。`e2e/fixtures/harness.ts` の `setAgentEntries()` が実装済みで、S63 の「履歴 resume で `agentSessionId` を決め打つ」と組み合わせれば作れる |
| `.claude/skills/e2e/reference/limitations.md` の `ownedByApp` の行 | 「肯定側を作れる。**未実装（#121 で扱う）**」 | `e2e/specs/S15-task-owned.spec.ts` に**実装済み**（#159 の棚卸しで発見） |

### 原因（判明している場合）

**制約の記述と、その制約を解く Issue の状態が紐づいていない。** Issue が closed になったときに、それを参照している注記を探して直す仕組みが無い。`make e2e-lint` も `lint-skills.sh` も、コメント内の Issue 番号は見ていない。

### 影響範囲

- `e2e/specs/` 全体（`#\d+` を参照するコメント）
- `.claude/skills/e2e/reference/limitations.md`
- `e2e/scenarios.yml` の `note`

### 対処方針

- [x] 今回見つかった分は起票済み（`ownedByApp` の行は #157、S68 系4箇所は #160 の周6 で #132 と同時に直す）
- [ ] **仕組みで防げるかを検討する。** 「コメント内の `#N` が closed な Issue を指していたら WARN を出す」検査を `scripts/lint-e2e.mjs` に足せるか。`gh` に依存するのでオフラインで落ちない形にする必要がある（WARN 止まりにする、`--offline` で飛ばす等）
- [ ] 足さない判断をするなら、その理由を `limitations.md` に書く

### 優先度

P3

### ステータス

未対処（周6 で個別の是正はするが、**再発を防ぐ仕組みは未着手**）

---

## 2. `make e2e-screenshots-check` は `make check` にも `make e2e` にも入っていない

### 症状

画像の中身が実装とずれても、**明示的に回さない限り検出されない**。この束ねは周3 / 周4 / 周9 で見た目を変えるので、回し忘れると古い画像が README で配布され続ける。

### 原因（判明している場合）

**意図的な設計。** CLAUDE.md が「画面を意図的に変えたときだけ落ちてよいので `make e2e` には含めていない」と明記しており、`css-substitution-check` と同じ扱い。穴ではなく運用。

### 影響範囲

- 周3（#134 の配色）/ 周4（#137 の文言）/ 周9（#135 のコンテキストメニュー）
- 周5（#138）は**逆に差分0枚が期待値**で、落ちたら置換ミス

### 対処方針

- [ ] 各周の完了条件に `make e2e-screenshots` の実行を明記した（`overview.md` の表）。**周ごとに消し込む**
- [ ] 画素差ゼロでバイトだけ変わった画像はコミットに含めない（判定は loop.md の Pillow レシピ。**必ず RGB で比べる**）

### 優先度

P3

### ステータス

未対処（記録のみ。仕様として妥当なので、忘れないための記録）

---
