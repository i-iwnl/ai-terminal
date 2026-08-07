# Known Issues

実装中に発見された未解決のバグ・先送りした課題。
詳細な観察記録は `worklog.md` を参照。

---

## 1. `computeYourTurnSince` も重複 sessionId で結果が打ち消し合う

### 症状

同じ `sessionId` を持つタスクが2件あると、片方の行で `next.set(id, now)` され、もう片方の行で
`next.delete(id)` されるため、「待たせている時間」が一切表示されない（縮退表示のまま固定される）。

### 原因

`src/main/agents/yourTurnSince.ts` の `prevById` も `detectAndNotifyCompletions` と同じく
sessionId をキーにした Map（後勝ち）で畳んでいる。記録の Map 自体も sessionId キーなので、
1つの ID に2つのプロセスの状態が混ざる。

### 影響範囲

- サイドバーの「あなたの番」グループの待ち時間表示と並び順（`groupTasksForDisplay` が `yourTurnSince` で並べる）

### 対処方針

- [x] 周1 で `detectAndNotifyCompletions` と同じ複合キーに揃える

### 優先度

P2（通知の無限ループほど害は無いが、原因が同じなので同じ周で直す）

### ステータス

対処済み（周1）

---

## 2. `status: "waiting"` が「不明」として表示される

### 症状

許可プロンプトで止まっているセッションが、サイドバーで「不明」グループに並ぶ。
Dock バッジの「あなたの番」件数にも数えられない。実際には人間が許可を出さないと1歩も進まない。

### 原因

`src/shared/agent-status.ts` の `toTaskState` が `busy` / `idle` しか知らない。
`waitingFor` は `src/main/agents/claude.ts` のパースでも拾っていないため、Renderer まで届いていない。

### 影響範囲

- サイドバーの表示（グループ・ラベル・件数）
- Dock バッジ
- 完了通知の発火条件（`becameYourTurn` は unknown への遷移も「作業完了」に数える）

### 対処方針

- [ ] 周2 で `waitingFor` をパースし、`TaskState` 上の扱いを決める

### 優先度

P2

### ステータス

未対処

---

## 3. `waitingFor` の視覚配置が決まっていない（5人の対案が割れた）

### 症状

`waitingFor`（許可待ち / 入力待ち / ダイアログ待ち）を画面のどこに出すかについて、
design-review の5ペルソナが**5通りの対案**を出し、しかも正面衝突した。

- macOS: 行の状態語（`.task-item__state`）を差し替える
- IA: **状態語の差し替えには反対**（スクロールで見出しが画面外に出るので、行が所属グループを語り続ける性質が失われる）。経過時間の語尾に畳む
- ヘビーユーザー: 行には出さず通知本文へ（縦が 21% 減るのが最大のコスト）
- a11y: `aria-label` は必須。視覚は名前行（メタ行は 11px で、このアプリには文字拡大手段が無い）
- 保守: メタ行でよいが4〜5文字に揃え、`basename(cwd)` より前

### 対処方針

- [x] 周2-g では `aria-label` への追加だけ行う（全員一致の部分）
- [ ] 視覚配置は次周。実機で1週間使ってから決める（ヘビーユーザーの提案）

### 優先度

P3

### ステータス

意図的に先送り

---

## 4. コメントが実装に追い越されている箇所が4つ（周2 のついでに直す）

### 症状

| 箇所 | 書いてあること | 実態 |
|---|---|---|
| `src/renderer/src/tabs/tabYourTurn.ts:4,37` | 「busy 以外 = あなたの番」 | 実装は `toTaskState(...) === 'your-turn'` で `unknown` を含まない |
| `src/main/menu.ts:353` | 同上 | 同上 |
| `src/renderer/src/styles.css:1819` | 「状態の対応は TaskList.tsx の `toTaskState()` が唯一の正」 | 正は `src/shared/agent-status.ts` |
| `docs/PLAN.md:62-71` | `claude agents --json` の実機出力（v2.1.220） | `waiting` も `waitingFor` も無い。`claude.ts:7-9` がここを参照している |

### 優先度

P3（`7d5c38d docs: 実装に追い越されたコメントを実態に合わせる` と同種）

### ステータス

未対処

---

## 5. `src/main/agents/claude.ts` に単体テストが1本も無い

### 症状

`parseAgentsJson` / `toAgentTask` が非 export で、テストから到達できない。
`grep -rn "listClaudeAgents\|parseAgentsJson" test/unit/` は0件。

### 原因

`completionNotice.ts` の切り出し前とまったく同じ形の死角。**#241 の原因そのもの。**

### 対処方針

- [ ] 周2-b で `parseAgentsJson` を export し、`test/unit/claude-agents.test.ts` を新設する

### 優先度

P1

### ステータス

未対処

---

## 6. レビューが見つけた、この Issue の外の課題

⛔ **ここから GitHub Issue を起こさない**（ルート CLAUDE.md）。切り出したくなったら周を1つ増やす。

| 課題 | 根拠 | 優先度 |
|---|---|---|
| **サイドバーの文字を拡大する手段がアプリに無い**（WCAG 1.4.4 未達） | `menu.ts:216` で Electron の zoom ロールを全削除し、`Cmd+=` を `fontSize` に再割り当て。`S81:70` が「サイドバーは変わらない」ことを固定している。メタ行 11px を誰も拡大できない | P2 |
| **通知にエスカレーションが無い** | 実機の「5時間31分」は、通知を1回逃したらその後は永久に何も鳴らないことの証拠。ただし #241 の直後なので慎重に（`taskIdentity` ごとに1回だけ・N分後の再通知に限る） | P2 |
| **`yourTurnSince` の再起動リセットで、一番長く待たせている行が最下段に来る** | `agent-status.ts:94-96` が `yourTurnSince ?? POSITIVE_INFINITY` でソート。記録は Main のメモリのみ（`poller.ts:61-78`）。`startedAt` への段階的フォールバックで直る | P2 |
| **ポーリングにバックオフが無い** | `poller.ts:211-216` は常に `pollIntervalMs`。非表示かつ busy 0件でも 3秒ごとに `execFile` + tmux 列挙 = **1日 57,600 プロセス生成** | P3 |
| **`Cmd+Option+1/2/3` がフォーカスを移していない** | `App.tsx:757-763` はパネル切替と `announce` のみ。`src/renderer/src/sidebar/` に行への `.focus()` が無い | P3 |
| **押せる行と押せない行の差が、既定状態で視覚的に伝わっていない** | ホバーの塗り（`--surface-2` 対 `--surface-0`）が **1.16**。読み上げには `taskRowActionLabel` があるので非視覚側だけ救われている | P3 |
| **`--border-row #232323` が `--surface-0` の上で 1.17**（行の区切りが事実上見えない） | `prefers-contrast: more` では `--border-control`（4.29）に差し替わるので、高コントラスト設定の人だけ救われている | P3 |
| **タスク一覧の取得エラーで一覧が全消えする** | `claude.ts:61` がエラー時 `tasks: []` を返し `applyEvent` が全消し。タイムアウト5秒・ポーリング3秒なので、claude が重いと**3秒ごとに一覧が消えて赤帯が出る点滅**になる | P2 |
| **gemini がタスク一覧に1件も出ない** | Main は `claude agents --json` しか叩かない（`taskRow.ts:91-93`） | P2 |
