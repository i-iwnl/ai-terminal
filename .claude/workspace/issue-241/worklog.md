# Worklog

時系列の作業ログ。**設計判断の根拠**と**学んだ教訓**を中心に記録する。
コード差分は git log を参照、現状の構造は `architecture.md` を参照。

---

## 2026-08-07 - 原因特定とワークスペース作成（周0）

### 実施内容

- 「通知音がなんらかのタイミングで無限ループする」という報告を受けて原因を特定した
- 実機の `claude agents --json` に**同じ `sessionId` を持つ別プロセスが2件**存在することを確認した
  （pid 47307 = `waiting` / pid 80821 = `busy`、いずれも `82dae66a-…`）
- `detectAndNotifyCompletions` の判定だけを実データで回し、**一覧を1ミリも変えずに毎周回1件通知が出る**ことを再現した
- `~/.ai-terminal/config.json` が `pollIntervalMs: 3000` / `notifyOnIdle: true` / `notifySound: true` /
  `notifySoundId: "Blow"` / `scopeAgentsToCwd: false` であることを確認した
  （**`scopeAgentsToCwd: false` なので、マシン上のどのリポジトリで重複が起きても鳴る**）
- Issue #241 を起票し、ワークスペース4ファイルを作成した

### 設計判断

- **突き合わせキーを `pid ?? sessionId` にする**: `sessionMatch.ts` が既に「pid は CLI 側の `/resume` を
  跨いで変わらない」と実測で結論づけている。重複 `sessionId` は恒常的に起きうる（#239 と同じ現象）
- **判定を純粋関数へ切り出す**: `computeYourTurnSince` を切り出したのと同じ理由。`poller.ts` の中にある
  ままでは単体テストも E2E も一度も実行できず、**実際にこの不具合を素通しした**

### 教訓

- **`computeYourTurnSince` を純粋関数へ逃がしたとき、隣に同じ形の未テスト関数が残っていた。**
  「どのテストがどの区間を通るか」を機能の端から端までなぞっていれば、そのとき見つかっていた
  （`loop.md` の「両端だけ固定して、真ん中が無テスト」そのもの）
- **Map で畳むとき、キーが一意である保証を確かめていなかった。** `sessionMatch.ts` は
  「1本の tmux セッションを2つのタスクが取り合わない」ところまで注意深く書いてあるのに、
  同じディレクトリの `poller.ts` は `new Map(previousTasks.map(...))` を素で書いている

### 次に再開するとき最初に読むべきこと

- **周1 の計画をユーザーに提示し、承認を得るところから。** 提示内容は `overview.md` の「2. 完成条件」の周1 の4項目
- 実装対象は `src/main/agents/completionNotice.ts`（新設）と `src/main/agents/poller.ts` の
  `detectAndNotifyCompletions`。参考にする既存の形は `src/main/agents/yourTurnSince.ts`
- **テストは「修正前のコードで赤くなること」を実際に戻して確認するまで、書いたことにしない**
- ブランチ `fix/241-notify-loop` は作成済み。コミットはまだ1本も無い

---

## 2026-08-07 - 周1: 突き合わせキーを pid にして、判定を純粋関数へ出す

### 実施内容

- `src/main/agents/taskIdentity.ts` を新設（`taskIdentity` / `indexByIdentity`）
- `src/main/agents/completionNotice.ts` を新設し、`detectAndNotifyCompletions` の判定を `selectCompletedTasks` へ出した。
  `poller.ts` に残したのは副作用（設定の参照・通知・Dock バウンス・`previousTasks` の更新）だけ
- `yourTurnSince.ts` と `poller.ts` の `yourTurnSince` 参照を同じキーに揃えた
- `test/unit/` に `completion-notice.test.ts`（16件）と `task-identity.test.ts`（8件）を追加、
  `your-turn-since.test.ts` に3件追加。`make check` は 803 件 green

### 検証: 書いたテストが赤くなることの確認（壊し方を5通り）

| 壊し方 | 結果 |
|---|---|
| 1. `taskIdentity` を `sessionId` に戻す（修正前の実装） | **13 failed / 17 passed** |
| 2. `indexByIdentity` の曖昧ガードを外す（Map の後勝ちに任せる） | **3 failed / 27 passed** |
| 3. `selectCompletedTasks` を修正前の実装に丸ごと差し替える | **5 failed / 25 passed** |
| 4. 初回ポーリングの早期 return を外す | **緑のまま**（後述） |
| 5. 消えたセッションの busy 判定を落とす（消えたら全部通知） | **1 failed / 29 passed** |
| 6. `computeYourTurnSince` の記録キーと poller の参照キーをずらす | **1 failed / 9 passed** |

### 検証: 実データ・実機

| 確認したこと | 結果 |
|---|---|
| 生きている `claude agents --json`（重複2件あり）を修正前ロジックで3周 | **毎周 1 件通知**（`gecipe-esports-english-15 (waiting) pid=47307`） |
| 同じ実データを修正後 `selectCompletedTasks` で3周 | **毎周 0 件** |
| 実機: `/Applications/ai-terminal.app`（修正前のリリース版、pid 21364）の `afplay` 起動 | **20 秒で 7 回**（`Blow.aiff`。3秒間隔＝ポーリング周期そのもの） |
| 実機: 同じ時間帯の dev 版（本ブランチ、pid 33021、同じ config・同じ CLI を見ている） | **0 回** |
| 実機: サイドバーの一覧（重複が実在する状態） | 7件が正しく並ぶ。重複した2プロセスも別行のまま（`あなたの番 2件 / 作業中 3件 / 不明 2件 / タブに戻せる AI 1件`） |
| 近傍 spec（S12 / S15 / S47） | 3 passed |

⭐ **修正前と修正後を実機で同時に走らせて比較できた。** 同じ `claude agents --json` を
3秒間隔で見ている2つのアプリのうち、**リリース版だけが鳴った**。

### 設計判断

- **`taskIdentity` は pid 側も sessionId 側も前置する**（`pid:` / `session:`）。片方だけ前置した最初の実装は、
  自分で書いたテストが即座に落とした（`sessionId` が文字列 `"pid:42"` なら衝突する）。
  **UUID だから衝突しない、という想定はこちら側では持てない**（鉄則5）
- **`indexByIdentity` はキーが重複したら索引に入れない。** Map の後勝ちに任せると比較相手が
  配列の並び順で決まる。**曖昧なら遷移を検知しない**ほうを選んだ（通知を1回落とすより、
  何も起きていないのに鳴り続けるほうが害が大きい）。pid が取れていれば発動しない保険

### 教訓

- ⭐ **「初回ポーリングでは通知しない」テストは恒真だった。** `undefined` と空配列が同じ出力になるので、
  早期 return を置いても外しても緑。**分岐そのものを消して**、テストにも
  「これは characterization であって関門ではない」と明記した。
  `loop.md` の「revert しても green」の型をそのまま踏んだ
- ⭐ **無限ループは条件が揃ったときだけ始まり、勝手に止まる。** 重複した2行のうち
  **配列で後ろにある行が busy で、前にある行が非 busy** のときだけ発火する。
  検証中に pid 80821 が `busy` -> `waiting` に変わった瞬間、修正前のロジックでも 0 件になった。
  **「再現しなくなった」を「直った」と読み違えうる**ので、判定は実データの重複そのもので固定した
- **`tsx` でリポジトリのソースを直接叩くときは `--tsconfig tsconfig.node.json` が要る**（`@shared` の解決）

### 次に再開するとき最初に読むべきこと

- **周1 は完了。次は周2（`status: "waiting"` の意味づけ）の計画から。**
- 周2 の材料は調査済み: `claude` 2.1.224 のバイナリを読むと、`waitingFor` の値は
  **`"permission prompt"` / `"input needed"` / `"dialog open"` の3つだけ**
  （`zfv[kind] ?? "permission prompt"` という表。`zfv` は2 kind ぶんしか持たない）。
  **いずれも「人間が何かしないと進まない」**ので、`waiting` は `your-turn` に寄せるのが素直
- **周2 は `/design-review` の起動条件に該当する**（「状態の見せ方を変える」。行がグループ間を移動し、
  「あなたの番」の件数と Dock バッジの数字が変わる ＝ 画素が動く）
- 周1 のコミットはまだ無い。ブランチは `fix/241-notify-loop`

---

## 2026-08-07 - 周2 の計画ゲート: `/design-review`（5ペルソナ）で案の前提が3つ覆った

### 実施内容

- 案（`waiting` の見せ方。提案 A/B/C/D）を書き、5ペルソナに並列レビューさせた
- 案は `.claude/workspace/` の外（scratchpad）に置いたまま。**レビューで覆ったのでリポジトリに入れない**

### 指摘した人数で並べた結果

| 人数 | 指摘 | 扱い |
|---|---|---|
| **5人** | 提案 A（`waiting` -> `your-turn`）に賛成 | **採用** |
| **5人** | 提案 B（4つ目の状態 `blocked`）に反対 | **却下** |
| **5人** | **案の影響表に `Cmd+J` とタブバーの状態ドットが抜けている** | **前提が不完全。A の価値はここが最大** |
| **5人** | 提案 C をメタ行（11px・`--text-tertiary`）に置くことに反対 | **置き場所を変える** |
| **4人** | **E2E フィクスチャに `waiting` が1件も無く、A も C も関門を1本も通らない** | **関門を先に作る** |
| **3人** | 通知タイトルが `waiting` でも「作業が完了しました」と言う（嘘） | **非目標から外す** |

### 覆った前提（3つ）

1. ⭐ **A が直す本体はサイドバーではない。** `tabYourTurn.ts:48` が `toTaskState(...) === 'your-turn'` で絞るため、
   **許可プロンプトで止まっているペインへ `Cmd+J` で一生飛べず**、`showNotice('あなたの番のタブはありません')`
   まで出る（実機で2本が5時間31分待っている状態で）。タブバーの状態ドット（`TabBar.tsx:493`）も無言。
   案はこの2面を1文字も書いていなかった。
2. ⭐ **「段2 は画素が動く」は誤り。** `e2e/fixtures/harness.ts:122-143` の既定フィクスチャは `busy` / `idle` の
   2件だけで、`e2e/` 配下に `waiting` は grep 0件。**A を入れても E2E 103本は1本も赤くならず、
   `docs/images/` 13枚は1画素も動かない。** これは周1 を素通しした構図
   （`completionNotice.ts:6-9`）とまったく同じ穴。
3. ⭐ **1-4 の「2つの面が違うことを言っている」は、A では半分しか直らない。** 嘘をついているのは通知側で、
   `poller.ts:279` の `title: 'Claude の作業が完了しました'` は `becameYourTurn(busy, waiting) === true` で発火し、
   **同じ文字列が Slack / Discord にも飛ぶ**（`notify/index.ts:70`）。「完了」を読んだ人は急いで戻らない。

### 事実誤認の訂正（レビューが見つけたもの）

- **提案 D の症状が事実と違う。** 実データの重複2件は `waiting` と `busy` で、`groupTasksForDisplay` が
  **別グループの別 `<ul>`** に振り分けるため兄弟にならない。React の key は兄弟間で一意なら足りる。
  衝突するのは「同 `sessionId` かつ同 status」のときだけで、**それは未観測**。D は「壊れているものを直す」
  ではなく「壊れうる形を潰す衛生」。PR 説明に虚偽の再現手順を残さないこと
- **A 直後は「5時間31分」が通算表示のまま。** `yourTurnSince` は Main のメモリ（`poller.ts:61-78`）なので、
  次に busy を1周期挟むまで「待たせています」にならない。実機確認の期待値としてこれを書いておかないと
  「直っていない」と判定される
- ⭐ **周1 で私が書いた `test/unit/completion-notice.test.ts` の「busy -> 未知の status でも通知する」が
  `status: 'waiting'` を使っている。** A の後は `waiting` が既知になるのでテスト名が嘘になる。
  `waiting_for_input` に差し替える
- コメントが既に事実とずれている箇所が3つ: `tabYourTurn.ts:4,37` と `menu.ts:353`（「busy 以外 = あなたの番」だが
  実装は `unknown` を含まない）、`styles.css:1819`（「正は TaskList.tsx の toTaskState()」だが正は `agent-status.ts`）
- `docs/PLAN.md:62-71` の実機出力に `waiting` も `waitingFor` も無い

### レビュアーどうしが矛盾した点（統合で決めたこと）

**提案 C の置き場所で5人が5通りの対案を出した。**

| 誰 | 対案 |
|---|---|
| macOS | 行の状態語（`.task-item__state`）そのものを差し替える |
| IA | **状態語の差し替えには反対**（スクロールで見出しが画面外に出るので、行が所属を語り続ける性質が失われる）。経過時間の語尾に畳む |
| ヘビーユーザー | 行に出さず**通知本文**へ回す（切り替える前に見ているのはサイドバーではない） |
| a11y | `aria-label` に必ず入れる（行は `<button aria-label>` なので**視覚だけ実装すると支援技術に何も届かない**）。視覚は名前行 |
| 保守 | メタ行でもよいが4〜5文字に揃え、`basename(cwd)` より前。ラベル辞書は `claude.ts` ではなく `agent-status.ts` |

**決定: 今周は `aria-label` への追加だけにする（全員一致の部分）。視覚配置は割れているので次周に回す。**
理由: `screenReaderMode` の既定が `false` かつ WebGL レンダラ（`useTerminal.ts:87-91`）なので、
**許可プロンプトの本文は支援技術に原理的に届いていない**。`aria-label` は「便利」ではなく機能の回復で、
かつ画素が動かないので撮影レーンの議論に入らない。

### 次に再開するとき最初に読むべきこと

- **周2 は計画に戻した。** 組み直した PR 分割は `overview.md` の「4. 直近の次アクション」
- ⛔ **`e2e/fixtures/harness.ts:121-143` の既定フィクスチャを変えないこと。** 「ここを変えると既存シナリオが
  軒並み動く」と本人が書いており、実測で E2E 7箇所 + README 画像8枚が動く。
  `waiting` の検証は `setAgentEntries`（`harness.ts:177`）で起動後に差し替える（`S12:133-144` が手本）
- ⛔ **提案 B（4つ目の状態）を再提案しないこと。** 5人全員が反対。決定的な理由は
  「4色目の候補は既存3色のどれかと必ず 1.01〜1.56 に落ちる」（a11y が Machado 2009 で総当たり計算）と、
  「6箇所すべてで正解が『your-turn と同じ』＝ A + 食い違う機会を6つ足すだけ」（ヘビーユーザー）
- レビュー本文は5体のサブエージェントの返答にしかない。要点は上の表に写した

---

<!-- 以降、作業のたびにセクションを追記 -->
## 2026-08-07 - 周2: `waiting` の意味づけ（実装・検証・文書）

### 実施内容

- 周2-a: `taskIdentity.ts` を `src/shared/` へ移動（中身は変えず）。`TaskList.tsx` の React key を `taskIdentity(task)` に
- 周2-b: `claude.ts` の `parseAgentsJson` を export し、`test/unit/claude-agents.test.ts` を新設（13件）
- 周2-c: `AgentTask.waitingFor` を追加し `claude.ts` でパース（**ユニオン型に絞らない**。鉄則5）
- 周2-d: **関門を先に作った。** `e2e/specs/S106-waiting-status.spec.ts` + `scenarios.yml`
- 周2-e: `toTaskState` に `waiting -> your-turn`。`agent-status.ts` の原則を
  「翻訳してよいのは値の集合を実測で確定できた語だけ」に書き換え
- 周2-f: 通知タイトルを `completionTitle()` で出し分け（`Claude が実行許可待ちです`）
- 周2-g: `describeWaitingFor()` を `agent-status.ts` に置き、メタ行と `aria-label` の両方に出す
- コメント齟齬4箇所（`tabYourTurn.ts` x2 / `menu.ts` / `styles.css`）と `docs/PLAN.md` の実機出力、README を更新

### ⭐ 関門が本物の穴を捕まえた（計画の修正）

**`aria-label` にだけ足す**という周2-g の当初計画は**間違いだった。** S106 を書いて回したら
`aria-label` が `null` で落ちた。**押せる行だけが `<button aria-label>` で、押せない行は
`<div>`（アクセシブル名を持たない）**。つまり:

| 実装 | 押せる行 | 押せない行 |
|---|---|---|
| `aria-label` にだけ足す（当初計画） | 届く | **届かない** |
| 視覚にだけ足す | **届かない**（`aria-label` が子要素を上書き） | 届く |
| **両方に足す（採用）** | 届く | 届く |

design-review の a11y は「行は `<button aria-label>` なので視覚だけでは届かない」と正しく指摘したが、
**その裏返し（押せない行には `aria-label` が無い）は5人とも書いていなかった。**
`known-issues.md` 3番の「視覚配置は次周」は**この周に前倒しせざるを得なかった**。

### 検証: S106 が赤くなることの確認（壊し方5通り）

| 壊し方 | 結果 |
|---|---|
| `toTaskState` から `waiting` の翻訳を外す | **1 failed** |
| 視覚（メタ行）から `waitingFor` を消す | **1 failed** |
| `aria-label` から `waitingFor` を消す | **1 failed** |
| 未知の `waitingFor` を「不明」で潰す | **1 failed** |
| 語を「許可待ち」単独に戻す | **1 failed** |

### 検証: 関門・実機

| 確認したこと | 結果 |
|---|---|
| `make check` | 825 passed（53 files） |
| `make e2e` | **0 failed / 112 passed**（flaky 5件はリトライで green・本 PR の対象外） |
| `make e2e-lint` | PASS=847 FAIL=0 |
| `make e2e-screenshots` | **回していない**。既定フィクスチャに `waiting` が無いので画素は動かない |
| 実機: グループ見出し | `あなたの番 7件 / 作業中 1件 / タブに戻せる AI 1件`（**「不明」が消えた**） |
| 実機: 待ち行のメタ行 | `実行許可待ちgecipe-esports-englishwaiting6時間51分` |
| 実機: 待ち行の `aria-label` | `あなたの番、gecipe-esports-english-15、タブに戻す、実行許可待ち、gecipe-esports-english、CLI の生の状態は waiting、6時間51分` |
| 実機: サイドバー幅 | 260px（既定） |
| ⚠ 実機: **待ち行だけメタ行が2行になる** | メタ行の高さ **14px -> 33px**、行高 **55px -> 73px**（+18px） |
| 実機: `afplay` の起動（25秒） | **0 回**（周1 の修正が効いたまま） |

### 設計判断

- **表示語は `agent-status.ts` に置く**（パースは `claude.ts`）。鉄則4 は「パースを1ファイルに閉じ込める」で、
  日本語ラベルまで置くと「パース」と「表示語」が同居し、CLI 更新で直す場所が2種類の理由で混ざる
- **「許可待ち」単独にしない。** macOS の権限（通知・アクセシビリティ）と誤読される。
  このアプリはそれらの許可を求める側でもあるので実際に紛らわしい -> `実行許可待ち`
- **`waitingFor` を3値のユニオン型にしない。** 実測は 2.1.224 時点のもので CLI の約束ではない。
  絞ると4つ目が来た瞬間にパースが落とす（鉄則5）

### 教訓

- ⭐ **「支援技術に届ける」は要素の種類で分岐する。** 同じコンポーネントでも押せる行と押せない行で
  アクセシブル名の作られ方が違う。**片方だけ見て「届いた」と言えない**
- ⭐ **5人のレビューでも裏返しは出ないことがある。** a11y は `aria-label` の上書きを正確に指摘したが、
  `aria-label` が無い側は誰も見ていなかった。**関門を先に作ったから捕まえられた**
  （実装 -> 関門の順だったら、押せない行で届かないまま出荷していた）

### 次に再開するとき最初に読むべきこと

- **周2 は完了。`overview.md` の完了条件はすべて [x]。**
- 残っている判断は1つ: **`waitingFor` の視覚配置**。いまはメタ行の先頭に置いており、
  **待ち行だけ行高が 55px -> 73px に増える**（実測）。design-review では5人の対案が割れたので、
  1週間使ってから決める。数字は上の表にある
- `known-issues.md` 6番に、レビューが見つけた**この Issue の外の課題が9件**ある。⛔ ここから起票しない
