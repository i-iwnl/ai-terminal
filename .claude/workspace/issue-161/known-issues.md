# Known Issues

実装中に発見された未解決のバグ・先送りした課題。
詳細な観察記録は `worklog.md` を参照。

---

## 1. #146（spawn 失敗モード）は実現できない可能性がある

### 症状

`e2e/fixtures/harness.ts` に「PTY の spawn を確実に失敗させるモード」を足したいが、**そもそも node-pty が同期的に失敗しない**。

### 原因（判明している場合）

PATH に無いコマンドを渡しても、PTY はいったん起動してすぐ終了する。そのため `withoutCli: true` では `src/renderer/src/tabs/useTabs.ts` の `describeSpawnError` を踏めない。これは `e2e/specs/S11-cli-missing.spec.ts` の冒頭コメントが**実測として記録している**。

`e2e/specs/S55-notice-severity.spec.ts` が severity の検証を「PTY の正常終了 / 異常終了」に相乗りさせているのは、この制約への対処であって手抜きではない。

### 影響範囲

- `e2e/fixtures/harness.ts` の `LaunchOptions`
- `e2e/specs/S55-notice-severity.spec.ts`
- 検証対象は `src/renderer/src/tabs/useTabs.ts` の `describeSpawnError` / `spawnLeaf`

### 対処方針

- [ ] 周1 で実際に試す。**同種の課題（#83 の動的フィクスチャ）は `setAgentEntries()` として解決できたので、同じ枠組みで足せる見込みはある**
- [ ] **できなかった場合は、何を試して何が起きたかを `.claude/skills/e2e/reference/limitations.md` に追記して #146 を close してよい**。「やってみたが無理だった」という記録に価値がある
- [ ] 判定を純粋関数に切り出して `test/unit/` で固定する道も検討する（このリポジトリには前例が8つあり、既定の作法）

### 優先度

P3

### ステータス

未対処（周1 で判定する）

---

## 2. #155 は事前実測の結果で周の中身が変わる

### 症状

「gemini に `--session-id` を渡して tmux セッション名を claude と対称にする」という案は、**`--session-id` で渡した UUID が `gemini --list-sessions` の行末 `[UUID]` と一致すること**が前提。一致しなければ resume 時に名前を再現できず、案そのものが成立しない。

### 原因（判明している場合）

`--resume` は今も `latest` か index しか受け取らない。したがって resume 時の tmux セッション名は `--resume` の引数からではなく、履歴側の `stableId`（`src/main/history/reader.ts` の `GEMINI_LINE_RE` が拾う UUID）から作る必要がある。**その2つが同じ UUID である保証は、まだ測っていない。**

### 影響範囲

- 周6 の中身そのもの（実装するか、記述の是正だけで閉じるか）
- 否定的だった場合でも、**4箇所に転記された誤った前提**（`src/main/pty/tmux.ts` の冒頭コメント / `test/unit/pty-plan.test.ts` / `README.md` / `.claude/skills/terminal/reference/pty-pitfalls.md`）の是正は残る

### 対処方針

- [ ] 周6 の冒頭で測る。`gemini --session-id <UUID>` で起動 → `gemini --list-sessions` の行末を見る
- [ ] `--session-id` に既存の UUID を渡したときの挙動（新規作成 / 既存への再開 / エラー）も測る
- [ ] **測った Gemini CLI のバージョンと日付を必ず記録する。** `reader.ts` のコメントが v0.37.0 基準で古くなっていたのと同じことが起きる
- [ ] 否定的なら実装せず、4箇所の記述を実測日つきで是正して close する

### 優先度

P3

### ステータス

未対処（周6 で判定する）

---
