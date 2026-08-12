# Worklog

時系列の作業ログ。**設計判断の根拠**と**学んだ教訓**を中心に記録する。
コード差分は git log を参照、現状の構造は `architecture.md` を参照。

---

## 2026-08-09 - 周0: ワークスペース作成と、Issue の前提の実測

### 実施内容

- `.claude/workspace/issue-244/` を作成（`overview.md` / `architecture.md` / `known-issues.md` / `worklog.md`）
- loop.md の計画ゲート「計画書の現状認識を実コードで測り直す」を実施。3体の Explore サブエージェントに
  (1) Main の閉じる経路と tmux、(2) Renderer の閉じる経路と TaskList、(3) テスト資産 を並列調査させた
- ルート `CLAUDE.md` に「応答の言語」節を追加（ユーザーへの返信は必ず日本語）。`lint-skills.sh` は PASS=95 / FAIL=0

### 設計判断

- **tmux 永続化そのものは残す**: Issue 側で 2026-08-09 に実測済み（生きたセッションが36〜39行の画面を保持）。
  `docs/PLAN.md:143` の動機は**アプリ終了**の話であって、タブを閉じる話ではない
- **`pty:kill` の意味を一律では変えない**: `app.on('before-quit')` → `disposePtyAll()` が
  **同じ `pty.kill()` を通る**。ここまで終了させると「アプリを閉じても生き残る」（このアプリの差別化）が壊れる。
  終了させるかは**呼び出し側**が決める
- **周を5つに割る**: 周1（関門）+ 周2（本命）を1本の PR にし、周3〜5 を分ける。
  ⛔ 周1だけを main に入れない（赤いまま push しない）

### 教訓（該当する場合）

- **Issue 本文の引用行番号は4件とも正しかった**（`defaults.ts:60` / `closeTabCopy.ts:264-268` /
  `TaskList.tsx:225` / `--surface-2` #222222）。loop.md が警告する「行番号のずれ」は今回は無し
- ⭐ **ずれたのは行番号ではなく「前提」のほう。3件**（詳細は `architecture.md` の「Issue が触れていない前提」）:
  1. Main は tmux セッション名を1つも持っていない（`PtyEntry` は `{pty, sender}` のみ）
  2. `Cmd+Shift+W` は「使わない」と2ファイルに明文の決定がある。Issue の提案と正面衝突
  3. 偽 tmux は `kill-session` にも `attach-session` にも応答しない
- **`entry.pty.pid` は tmux クライアントの pid** であって、ペイン内の `claude` / `gemini` の pid ではない。
  `listLiveAgentSessions()` の `pane_pid` と突き合わせる案は当たらない

### 次に再開するとき最初に読むべきこと

- **ユーザーへの質問が3件、回答待ち**（`known-issues.md` の1番 = ショートカット割当、周1のスコープ、
  終了の対象範囲）。回答が来るまで実装に進まない
- 回答が来たら、周1（偽 tmux の `kill-session` 実装 + 現状で赤くなる E2E の追加）から着手する。
  手本は `e2e/specs/S104-recover-live-session.spec.ts`（`launchApp({ config: { useTmux: true }, fakeTmux: true }))`）と
  `e2e/fixtures/tmuxLivePanes.ts`（⛔ 手で `join('\x1f')` しない）
- ⛔ `e2e/fixtures/harness.ts` の既定フィクスチャを変えない（E2E 7箇所 + README 画像8枚が動く）

---

## 2026-08-09 - 周1+2: 関門と「閉じる = 終了」の実装

### 実施内容

- **design-review を5ペルソナで実施**（`/design-review run-review`）。案は
  `design-review/proposal-v1.md`、改訂版は `design-review/proposal-v2-after-review.md`
  （**scratchpad はセッションで消えるのでワークスペースへ移した**）
- 周1: 偽 tmux に `kill-session` を実装 / `buildTmuxKillSessionCommand` / `killTmuxSession` / S107 / 単体3件
- 周2: `PtyEntry.tmuxSessionName` / `KillPtyRequest`（Contract 変更）/ preload / `useTabs.ts` の3箇所
- ユーザー決定2件: **確認は「2枚以上」+「busy」**、**`ウィンドウを閉じる Cmd+Shift+W` を同じ周でメニューに追加**

### ⭐ 関門が赤くなることの証明（loop.md「原因ごとに別々に1回ずつ」）

**周1 の時点（実装前）:**

```
Error: アプリが tmux kill-session を叩いていない
Expected substring: "aiterm-b78b3a37-843d-40d6-8e9a-500e7ae62c8a"
Received string:    ""
```

**周2 の実装後、3通りに壊して確認（毎回 `npm run build` を前置）:**

| 壊し方 | 出た赤 |
|---|---|
| `kill-session` の呼び出しごと消す | `アプリが tmux kill-session を叩いていない`（記録が空文字） |
| **`closeActivePane` 側だけ直し忘れる**（`terminateSession: false`） | part 2 だけ失敗、part 1 は緑 = **2経路を踏んでいることの証明** |
| セッション名を `ptyId` 由来にする | `Expected substring: "aiterm-e4fa6380-…"` = **名前違いを検出** |

復元後は再び緑（2.7s）。

### 設計判断

- **`pty:kill` の引数を `KillPtyRequest { ptyId, terminateSession? }` にした。**
  `before-quit` の `disposePtyAll()` は**このチャンネルを1度も通らない**ので、
  「アプリを閉じても生き残る」は自動的に維持される
- **tmux セッション名は Main（`PtyEntry`）が持つ。** Renderer に `aiterm-` を組み立てさせない
  （接頭辞の正は `buildTmuxSessionName` と `SESSION_NAME_PREFIX` の2箇所だけ）
- **アタッチ経路（`attachAgentSessionId`）でもセッション名を返す。** 返さないと
  「一覧から戻して、閉じたらまた残る」で累積が続く
- **`agentSessionId` が無い（orphan）ペインも名前は確定している**ので終了できる。
  これが確認条件から `persistentOrphaned` を外せる**前提条件**（保守レビューの指摘）

### 教訓（該当する場合）

- ⭐ **design-review が案の中核を2つ覆した。** 提案 C（告知を消す）と提案 E（行の右端にボタン）は
  **5/5 が反対**。改訂版の詳細は `design-review/proposal-v2-after-review.md`
- ⭐ **私が書いたコードにも2件の直撃があった:**
  1. `killTmuxSession()` を `spawnSync` で書いた。`isTmuxAvailable()` の作法を写したが、
     **あちらは起動時に1度だけ**呼ばれる。**頻度が違うものに同じ作法を写した**
  2. 偽 tmux が記録ファイルを**先に**書いていた。`expect.poll` が緑になった時点で
     まだ `live-panes` を書き換えていない瞬間があり、直後の同期 assert がフレークしうる
- ⭐ **`Cmd+Option+W` とタブバーの x を S107 に足しても意味が無かった。** どちらも
  `requestCloseTab` -> `closeTab` に合流する。**無検査だったのは `closeActivePane`** で、
  tmux ペインでこの経路を踏む spec は S90 を含めて1本も無かった
- **macOS の awk は `-F'\x1f'` を解釈しない。** `$'\037'` でバイトを渡す
- **私の案の事実誤認は6件**（`design-review/proposal-v2-after-review.md` §1-1）。とくに**画素の見積もりが逆**だった
  （提案 E は 0枚、提案 F が 8枚）

### 次に再開するとき最初に読むべきこと

- **改訂版の案 `design-review/proposal-v2-after-review.md` の §5「改訂した周の分割」が唯一の正。** 周1・周2 は完了
- **次は周3**: `summarizeClosingPanes(leaves, intent)` の `intent` 引数 + メニュー項目
  `AI を残してタブを閉じる` + `ウィンドウを閉じる Cmd+Shift+W` + `S90` の書き直し +
  `S104` の差し替え + README 3箇所（`:273` / `:329` / `:593`）
- ⛔ **`shortcuts.ts` と `menu.ts` の「`Cmd+Shift+W` は使わない」コメント2箇所を、
  理由付きで書き換える**（本来の macOS の用途に使うことになったため）
- ⛔ **`ptyKill` ハンドラを `async` にしない**（`manager.ts` のコメントが理由の唯一の正）

---

## 2026-08-09 - 周1+2 の code-review と是正

`/code-review high`（ワークフロー版・19エージェント）を未コミットの作業ツリーに対して実施。
**10件の指摘のうち7件が実欠陥**だった。

### ⛔ 過去エントリの訂正

- 周0 の「設計判断」に書いた「**`app.on('before-quit')` → `disposePtyAll()` が同じ `pty.kill()` を通る**」は
  **誤り**（design-review の2人が指摘し、`manager.ts` を読んで確認）。共有しているのは
  `entry.pty.kill()` というメソッドだけで、`disposePtyAll()` は IPC ハンドラを1度も通らない
- 周1+2 の「設計判断」に書いた「tmux セッション名は **`PtyEntry`** が持つ」も、この周で
  **`entries` とは別の `Map<ptyId, sessionName>`** に変えた（理由は下の1番）

### 直した実欠陥（7件）

| # | 指摘 | 直し方 | 関門 |
|---|---|---|---|
| 1 | `if (!entry) return` が tmux の終了より**手前**にあり、**PTY が先に死んでいるとセッションが永久に残る**（`Ctrl-b d` でデタッチした場合など）。**この Issue が直そうとしている累積そのものが再発する** | 判定を早期 return より前へ。名前は `entries` と**寿命が違う**ので別 Map に持つ | **S109 新設** |
| 2 | tmux セッション名で終了させるので、**同じセッションに繋がった別のタブの AI まで巻き添えで死ぬ**（`new-session -A` は同名があればアタッチ。`resumeHistory` にガードが無い） | 他の生きた PTY が同じ名前を使っていれば終了させない | **S110 新設** |
| 6 | `killTmuxSession()` が Main の素の `process.env` で tmux を叩く。**`TMUX_TMPDIR` を設定している利用者では別のサーバを見て空振りする**。しかも失敗を1行もログしない | `mergeUserEnv(process.env, loginShellEnv())` を渡す。`can't find session` 以外は警告する | （実機のみ） |
| 7 | `KillPtyRequest` の doc が**存在しないメニュー**を「唯一の正」として書いていた | 「まだ呼び出し元は無い。周3 で入る」と明記 | — |
| 8 | S107 の2回目の `tmux-session-name.txt` 読みが**書き込みを待っておらず**、1本目の名前を読みうる | `waitForNewSessionName(previous)` で「変わったこと」を待つ | — |
| 9 | ⛔ **不変条件「アプリ終了では tmux セッションを終了しない」の自動検査が無かった。** `disposePtyAll()` に1行足すだけで中核機能が消え、**画面には何も出ない**ので誰も気づけない | — | **S108 新設** |
| 10 | 無関係な `CLAUDE.md`（応答の言語）が同じ作業ツリーに混ざっていた | **別コミットに分けた** | — |

### 直さなかった3件と、その理由

| # | 指摘 | 判断 |
|---|---|---|
| 3 / 5 | 確認ダイアログと通知バナーが「AI は終了せず残っています」「履歴から再開できます」と**事実と逆のことを言っている** | **正しい。周3 の作業そのもの**（`intent` 引数）。⚠ **この周の時点ではアプリが嘘をつく**ので、周3 まで通してから push する |
| 4 | アタッチ（「タブに戻す」）したタブを閉じると、覗いただけのつもりのセッションが死ぬ | **意図した設計。** 返さないと「戻して、閉じたらまた残る」で累積が続く。破壊的な場合の受け皿は周4（`busy` なら確認） |

### 新しい関門が赤くなることの証明

| spec | 壊し方 | 出た赤 |
|---|---|---|
| S108 | `disposePtyAll()` に `killTmuxSession` を1行足す | `アプリ終了で tmux セッションを終了させている（「アプリを閉じても AI の作業を続ける」が壊れている）` |
| S109 | レビュー前の早期 return を戻す | `PTY が先に終了していると tmux セッションが残る` (S107 は緑のまま = 別の欠陥) |
| S110 | 共有ガードを外す | `別のタブがまだ同じ tmux セッションを使っているのに終了させている` |
| S110 | 常にガードして一度も終了させない | `最後の1枚を閉じても tmux セッションを終了させていない` |

### 検証

- `make check` 緑（828テスト） / `make e2e-lint` FAIL=0（PASS=879）
- `make e2e` フルセット: **116 passed / 5 flaky**。flaky は S42 / S59 / S66 / S72 / S99 で、
  いずれも tmux と無関係（既定フィクスチャは `useTmux: false`）。**5本を単独で回すと全部緑**
  （735ms〜1.6s）なので**マシン負荷起因で確定**（重いワークフローとビルドの直後に回した）

### 次に再開するとき最初に読むべきこと

- **周1+2 はコミット済み。次は周3**（`design-review/proposal-v2-after-review.md` の §5）
- ⚠ **いまアプリは嘘をつく状態**（閉じると AI は終了するのに、バナーは「終了せず残っています」と言う）。
  周3 の `intent` 引数がこれを直す。**周3 を通すまで push しない**
- ⛔ `ptyKill` ハンドラを `async` にしない / `disposePtyAll()` で tmux を終了させない
  （どちらもコメントと S108 が守っている）

---

## 2026-08-09 - 周3: 「閉じる」の2つの意味を、文言とメニューまで通す

### 実施内容

- `CloseIntent = 'terminate' | 'keep'` を新設し、`closeTabCopy` / `closedTabAnnouncement` /
  `closedTabChannel` / `needsCloseConfirmation` に渡した
- `AppAction` に `close-tab-keep-agents` を追加。メニュー「**AI を残してタブを閉じる**」（キー無し）
- メニューに「**ウィンドウを閉じる `Cmd+Shift+W`**」を追加（`role: 'close'`）
- `IpcSend.menuKeepableAgentCount` を新設し、残せる AI が0件ならメニュー項目を無効化
- S90 を書き直し（両方向を見る）/ S104 の前提を差し替え / S36 に新項目の関門を追加
- README を3箇所 + ショートカット表を実態に合わせた

### 設計判断

- ⭐ **`intent` は `summarizeClosingPanes()` には渡さない。** あれは「そのペインが**何であるか**」を
  数える関数で、意図とは独立。混ぜると `'terminate'` のときにプロバイダの内訳が失われ、
  「Claude 1 件の会話は履歴に残っている」と言えなくなる
  （保守レビューの対案3 は「全部 exiting に落とす」だったが、そこだけ変えた）
- ⛔ **確認条件は「消した」のではなく「まだ成り立つ側へ移した」。**
  `persistentOrphaned > 0` は `intent === 'keep'` のときだけ効く。残す操作では
  「拾えないまま残る」という事故がそのまま起きるため
- **`role: 'close'` の accelerator は明示が必須。** 既定は **`Cmd+W`** で、
  このアプリではそれが「ペインを閉じる」に割り当たっている。**1つのキーが2つの意味を持つ**
- **`registerAccelerator: false` は付けない。** ネイティブ role は OS がキーを処理するので、
  付けると**メニューをクリックする以外に到達手段が無くなる**

### 教訓（該当する場合）

- ⭐ **`menu-accelerators.test.ts` の関門を1件だけ免除した。** 免除は
  `ALLOWED_NATIVE_ROLE_ACCELERATOR_LABELS` に理由付きで載せ、**代わりに
  `renderer-lib.test.ts` で `matchShortcut` が `Cmd+Shift+W` を拾わないことを固定**した
  （関門を緩めるときは、緩めた分を別の関門で埋める）
- ⭐ **偽 tmux のセッション名を待たずに読む競合が、S107 の次に S90 でも出た。**
  spec ごとに書き直すのをやめ、`waitForNewTmuxSessionName()` として
  `e2e/fixtures/tmuxLivePanes.ts` へ切り出した（S104 / S107〜S110 / S90 が使う）
- **`app.evaluate()` の戻り値は構造化クローンを通る。** 未設定の accelerator は
  `undefined` ではなく **`null`** で返る（S36 で踏んだ）
- **`docs/images/S56-split-pane.png` はバイトだけ変わって画素差 0 だった**ので、
  コミットに含めなかった（loop.md の規約）

### 関門が赤くなることの証明

| 壊し方 | 出た赤 |
|---|---|
| `intent` を無視して常に「残る」文言を返す | S90: `not.toContainText` 失敗（live region に旧文言） |
| `closedTabChannel` が `intent` を無視する | S90: `toContainText` 失敗（面が入れ替わる） |
| メニュー項目を常に有効にする | S90: シェルタブで `enabled` が false でない |

### 検証

- `make check` 緑（839件）/ `make e2e-lint` FAIL=0（PASS=879）/ `lint-skills.sh` FAIL=0
- `make e2e` フル: **115 passed / 1 failed（撮影 S56）/ 5 flaky**。
  S56 を単独で回すと **947ms で緑**（落ちたときは 20秒タイムアウト × 2）。
  load average 6.99 だったので**負荷起因で確定**
- `make e2e-screenshots-check`: **13枚すべて画素差 0**（`PASS=39 / FAIL=0`）

### 次に再開するとき最初に読むべきこと

- **周1〜3 は完了。次は周4**（確認条件に `busy` を追加）。ユーザー判断済み:
  条件は「(1) 2枚以上」+「(3) 閉じる対象に `busy` の AI ペインがある」
- 実装は `needsCloseConfirmation()` に `AgentTask[]` を渡す配線が1本増える
  （`App.tsx` の `agentTasksRef.current` と `taskSessionKey()` で `status` が引ける）
- そのあと 周5（`border-left`）/ 周6（終了導線）/ 周7（押せない理由 + 8枚撮り直し）
- ⚠ **`make e2e` は負荷に弱い。** flaky が出たら**単独で回して切り分ける**（負荷なら数百 ms で緑）

---

## 2026-08-09 - 周4: 走っている AI を止めるときだけ確認する

### 実施内容

- `countWorkingAgentPanes(leaves, workingAgentSessionIds)` を新設（純粋関数）
- `needsCloseConfirmation()` の第3条件に「作業中の AI がある」を追加
- `closeTabCopy()` に「そのうち N 件はいま作業中です。途中まで進んだ作業はやり直しになります。」を追加
- `App.tsx` が `agentTasksRef` から `busy` のセッション ID 集合を作って渡す
- S111 新設 / README を2箇所

### 設計判断

- **条件は「枚数」ではなく「走っているか」**（Terminal.app の作法）。閉じるのは
  「終わったから」が大半なので、**確認が出る頻度が損失の重さに比例する**（見積もり 1〜3回/日）
- ⛔ **`status` の文字列を `closeTabCopy.ts` で解釈しない。** `busy` の判定は
  `toTaskState()` が唯一の正で、`App.tsx` がそれを通してから ID の集合を作る
- **キーは `taskSessionKey()`。** `claude` は CLI 内の `/resume` で `sessionId` を
  切り替えるので、`sessionId` 1本で突き合わせると外れる（#239 と同じ罠）
- **「残す」ときは `workingCount` に 0 を渡す。** 残す操作では走っているものが止まらないので、
  確認の理由にならない

### 教訓（該当する場合）

- ⭐ **「取り消せます」とは言えないので、何が戻らないかを言う。** tmux セッションを
  終了しても会話は `--resume` で戻るが、**実行中の作業は戻らない**。
  Undo ボタンを置くと**戻らないものを戻ると約束する**ことになる（a11y / macOS が独立に指摘）
- **`closedTabAnnouncement` には `workingCount` を渡していない。** 閉じたあとの告知で
  「作業中だった」と言っても行動が変わらない（もう終わっている）

### 関門が赤くなることの証明

| 壊し方 | 出た赤 |
|---|---|
| `busy` 条件を消す（安全弁ゼロに戻す） | `expect(dialog).toBeVisible()` 失敗 |
| **常に確認する**（ホットパスを潰す） | `expect(claudeTabs).toHaveCount(0)` 失敗 = **否定側が効いている証明** |
| 突き合わせを `idle` にすり替える | `expect(dialog).toBeVisible()` 失敗 |

復元後は緑（2.9s）。S111 単独 `--repeat-each=3` も全緑（2.1〜2.6s）。

### 検証

- `make check` 緑（847件）/ `make e2e-lint` FAIL=0（PASS=887）
- `make e2e` フル: **117 passed / 0 failed / 5 flaky**。flaky の顔ぶれは実行のたびに
  変わる（S44 / S56 / S65 / S93 / S97）ので**負荷起因**
- `make e2e-screenshots-check`: 13枚すべて画素差 0（PASS=39 / FAIL=0）

### 次に再開するとき最初に読むべきこと

- **周1〜4 は完了。次は周5**（`border-left: 2px solid var(--border-control)` で
  「押せる行」の手がかりを静止状態に出す。**幅コスト 0px**・`padding-left` を
  12px -> 10px に振り替えるので描画位置は動かない）
- ⚠ 周5 は**値の変更を伴う**ので `make css-substitution-check` が落ちてよい周だと明示する
- そのあと 周6（終了導線: 右クリック + メニューバー + `agentSessionKill`）/
  周7（押せない理由 + `errorKind: 'tmux-unavailable'` + 8枚撮り直し）
- 詳細は `design-review/proposal-v2-after-review.md` の §2-E' / §2-F'

---

## 2026-08-09 - 周5: 「押せる」を静止状態にも出す（左端 2px の線）

### 実施内容

- `button.task-item__row` に `border-left: 2px solid var(--border-control)` +
  `padding-left: calc(var(--sp-3) - 2px)`（**振り替えなので幅コスト 0px**）
- **S112 新設**（`e2e/specs/S112-clickable-row-affordance.spec.ts` + `scenarios.yml`）
- `design-rules` の §3 に「**『押せる』を塗りで表す道は、この配色では閉じている**」を追加
  （Issue 固有ではなく、案が変わっても残る閾値なので skill 側へ）
- README「5. 実行中タスクを一覧で見る」に1段落

### 設計判断

- **`padding-left` は `calc(var(--sp-3) - 2px)` で書く。** `10px` と直書きすると
  「12 から 2 を借りている」という**振り替えの関係が読めなくなる**。トークンを動かしたときも追従する
- ⛔ **`design-rules` 節5 の「左端 3px の色バー」の再提案ではない**ことを、
  **CSS のコメント・spec の doc・scenarios.yml の note・design-rules 本体の4箇所**に書いた。
  却下理由は「位置が同じで**色だけ**違う」で、こちらが分けているのは**有無**。
  書かないと次のレビューで却下済みとして差し戻される
- **`button.` を付けた要素セレクタで限定する。** 押せるかどうかを modifier クラスではなく
  要素の種類で表す、という `TaskList.tsx` の既存の決定に合わせる（クラスを足すと正が2つになる）

### 関門が赤くなることの証明（4通り。毎回 `npm run build` を前置）

| 壊し方 | 出た赤 |
|---|---|
| 実装前（規則そのものが無い） | `押せる行に左端の線が出ていない` Expected "2px" / Received "0px" |
| **補償の `padding-left` を忘れる** | `線を足したぶん中身が右へずれている` Expected 12 / Received 14 |
| **`button.` を外して全行に付ける** | `押せない行にまで左端の線が出ている` Expected "0px" / Received "2px" |
| 線と相殺量を両方 3px にする（相殺は成立） | `押せる行に左端の線が出ていない` Expected "2px" / Received "3px" |

⭐ **2番目が本命。** 「線が出ている」だけを見る spec だと、**押せる行と押せない行が
混ざる一覧がガタつく実装でも緑**になる。4番目は「太さの検査が死んでいないこと」を見ている。

### 教訓（該当する場合）

- ⭐ **`make e2e-screenshots-check` は `docs/images/` を見ていない。**
  比べているのは `e2e/.screenshots-out`（`make e2e` の第2レーンが吐く撮り立て）と
  作業ツリーの `docs/images/`。**`make e2e-screenshots` は `docs/images/` を直接上書きする**ので、
  その直後にチェックだけ回すと**「上書き後 対 古い撮り立て」**を比べることになる。
  今回はそれが結果的に「周4 のコードで撮った13枚 対 周5 のコードで撮った13枚」になり、
  **欲しかった比較そのものだった**が、**偶然そうなっただけ**。⛔ 「HEAD と比べてくれる」と誤解しない
- **コミット可否の判定は `git show HEAD:<path>` との画素比較で自分でやる。**
  13枚すべてが `M` になったが、実際の差は S16 / S18 が **3画素・1階調**、S31 が **1画素・1階調**
  （107 -> 106。`verify-screenshots.mjs` 冒頭が実測値として記録しているノイズと逐語一致）。
  **13枚とも `git checkout` で戻した = 周5 の画素は 0枚**
- **実機は E2E より強い状態を勝手に用意してくれる。** 本物の tmux に14本生きていたので、
  **押せる行14 + 押せない行2** が同じ一覧に並んだ状態で測れた（`dotX` は全17行で 12、
  行幅は全行 259 = 描画位置も幅も1pxも動いていない）。E2E では1本ずつ作る必要がある
- **README に書いた手がかりが、隣の画像には1本も写っていない**（`known-issues.md` 7番）。
  撮影レーンの既定は `useTmux: false` なので全行が `<div>`。周7 の撮り直しと同じ周で判定する

### 検証

- `make check` 緑（847件）/ `make e2e-lint` **FAIL=0**（PASS=895）/ `lint-skills.sh` FAIL=0
- 近傍 spec（S12 / S34 / S35 / S38 / S104 / S105 / S111 / S112）**8 passed**
- **実機確認済み**（agent-browser + CDP）。押せる行 `BUTTON` = `2px` / `rgb(122,122,122)` /
  `padding-left: 10px`、押せない行 `DIV` = `0px` / `12px`
- ⚠ **`make css-substitution-check` は予告どおり FAIL**（`border-left: 2px solid #7a7a7a` と
  `padding-left: calc(12px - 2px)` の2件が「0 -> 1箇所」）。**値の変更を伴う周なので落ちてよい**
- `docs/images` は **0枚**（上記のとおり戻した）

### 次に再開するとき最初に読むべきこと

- **周1〜5 は完了（周5 は未コミット）。次は周6**（`design-review/proposal-v2-after-review.md` §2-E' の後半）:
  一覧の行の右クリック + メニューバー `ファイル > 選択中の AI を終了` + **`IpcInvoke.agentSessionKill` の新設**
- ⭐ **チャンネルは2本要る**（§2-A' の表）。`resolveTaskRowAction` が `'recover'` を返す行は
  `hasOpenTab === false` = **Main に entry が無く ptyId が存在しない**ので、`ptyKill` では届かない。
  tmux 名の解決者は Main（`buildTmuxSessionName`）。⛔ Renderer に `aiterm-` を組み立てさせない
- ⚠ **行が消えたときのフォーカス**（§4-4）。終了に成功すると DOM から消えるのは
  **フォーカス中の要素そのもの**。次のフォーカス先（同グループの次の行、無ければ
  `.task-group__heading`）へ明示的に移さないと `<body>` に落ちる
- ⛔ **「戻す」ボタンを行に足さない**（§2-E'）。行そのものが既にその操作
- そのあと 周7（`errorKind: 'tmux-unavailable'` + パネル単位の理由 + メタ行の語「アプリ外」+ **8枚撮り直し**）
- 周6 は Main / preload / shared / Renderer / E2E を跨ぐので、**`/orchestrator` の起動条件に該当する**

---

## 2026-08-09 - 周6-a: 一覧の行から AI を終了する（右クリック導線）

⭐ **周6 を 6-a（右クリック導線）と 6-b（メニューバーのキーボード経路）に割った。**
1周に詰め込みすぎないため（周を増やすのは CLAUDE.md の作法）。

### `/orchestrator` で3体に分担した

| ワーカー | 担当 | ファイル |
|---|---|---|
| W1 | Contract + Main + preload | `shared/ipc.ts` / `shared/context-menu.ts` / `main/pty/manager.ts` / `main/menu.ts` / `preload/index.ts` |
| W3 | E2E 関門（先に書いて赤くする） | `e2e/specs/S113` / `S114` / `scenarios.yml` |
| W2 | Renderer の導線 | `sidebar/TaskList.tsx` / `App.tsx` / `sidebar/killSessionCopy.ts` / `sidebar/Sidebar.tsx` |

W1 と W3 はファイルが分かれるので並列、W2 はその後（Contract に依存するため）。

### 計画ゲートで実コードと食い違っていた前提（2件）

| proposal の記述 | 実際 |
|---|---|
| `PtyEntry.tmuxSessionName` に持たせる | **採っていない。** `entries` とは別の `Map<ptyId, sessionName>`（`tmuxSessionNames`）。周1+2 の code-review で「寿命が違う」ため変えた |
| メニューバー `ファイル > 選択中の AI を終了` | ⭐ **「選択中の AI」という概念が Renderer に1つも無い。** 行に選択状態も roving tabindex も無く、`App.tsx` に `selectedAgent` 相当もゼロ。**新設しないとメニュー項目の対象が定義できない** |

⭐ あわせて確定した事実: **押せない `<div>` 行は原理的に終了できない**
（`'none'` = タブも開いておらず `recoverable !== true` = tmux に生きたセッションが無い）。
`'focus'` の行は既存の「タブを閉じる」が担当する。**`agentSessionKill` に意味があるのは
`'recover'` の行だけ。**

### ユーザー判断2件

- **メニューバーの「選択中」= 最後にフォーカスした行**（周6-b で使う。6-a の時点で
  同じ ref を用意し、コメントに「周6-b がここを使う」と書いた。書かないと2つ目の state が生える）
- **確認は busy のときだけ**（周4 の「確認の頻度が損失の重さに比例する」をそのまま適用）

### 設計判断

- **チャンネルは2本。** `IpcSend.taskContextMenuShow` を新設した（既存の
  `IpcSend.contextMenuShow` の payload 型を判別ユニオンへ広げる案もあったが、
  あちらは `S91-terminal-context-menu.spec.ts` が固定しているターミナル面専用の契約で、
  **広げると S91 に波及する**）
- **`AppAction { type: 'kill-agent-session' }` は対象 ID を運ばない。** `close-pane` が
  「アクティブなペイン」を暗黙の対象にするのと同じ作法。Renderer が右クリックした行を覚えて適用する
- ⛔ **メニューに「タブに戻す」は作らない。** 行そのものがその操作（§2-E' の
  「『戻す』ボタンは作らない」をメニューにも適用）。`AppAction` に対応する type も無かった
- **共有ガードは既存関数を一般化して共用**（`isTmuxSessionSharedWithOtherPty(sessionName, ptyId?)`）。
  同じ判定を2箇所に書き写さない
- **確認ダイアログは既存の `CloseTabConfirmDialog` を再利用。** あれは「文言はこのファイルが
  決めない」設計なので、文言だけ新しい純粋関数（`killSessionCopy.ts`）で作った。
  ⛔ `closeTabCopy.ts` には足さない（あれは「タブを閉じる」の文言の正）

### ⭐ メインのレビューで直したもの: S114 の構造的欠陥

W3 が書いた busy 側の待ち合わせが
`lastPoppedItems()?.length` を `toBeGreaterThan(1)` で見ていた。
あれが返すのは**直近メニューの項目数**で、`taskContextMenuItems()` は常に1項目なので
**構造的に 1 から動かない**。W2 は「`toBeGreaterThan(0)` に緩める」を提案したが、
**それだと1つ前の行で出したメニューの記録が残っているので恒真化する**
（busy の右クリックでメニューが出なくても緑）。**累積 popup 回数の増加**で待つ形に直し、
`poppedCount()` の doc にこの2つの罠を書いた。

### 関門が赤くなることの証明

| # | 壊し方 | 出た赤 |
|---|---|---|
| 1 | 押せない `<div>` 行にもメニューを出す | S113 `押せない行を右クリックしただけでメニューが出ている` |
| 2 | 常に確認する（ホットパスを潰す） | S114 `toHaveCount(0)` 失敗（idle で確認が出た） |
| 3 | 一度も確認しない（安全弁ゼロ） | S114 `toBeVisible()` 失敗（busy で確認が出ない） |
| 4 | **右クリック時だけ対象を更新しない** | ⚠ **緑のまま**（下記） |
| 5 | `onFocus` と右クリックの両方から対象設定を消す | S113 `アプリが tmux kill-session を叩いていない` |
| A | 節がまるごと消えたときのフォールバックを消す | S115 `toBeFocused` 失敗（`h2.panel-scope` が inactive） |
| B | 同じ節の次の行へ移す処理だけを消す | S115 `toBeFocused` 失敗（残った行が inactive） |

⭐ **4番が緑だったのは実装の欠陥ではなく、検査が2経路を分離できていないこと。**
右クリックがボタンをフォーカスするので `onFocus` が冗長に担保している。
**「冗長な2経路のうち片方を壊しても緑」という形**は loop.md の表にまだ無い型。

### ⭐⭐ 実機でしか出なかったもの（agent-browser + CDP + 本物の tmux）

**偽 tmux では作れない状態を作るため、`PATH` に偽 `claude`（`sleep 900`）を置いて
本物の tmux に `aiterm-<uuid>` セッションを立てた。** これで「タブに戻せる AI」節に
押せる行を任意の本数だけ作れる（`claude agents --json` に出ていなくてもこの節には出る）。

1. ⭐ **本物の tmux でセッションが実際に終了し、中のプロセスも死んだ。**
   `scenarios.yml` の S107 が「本物の tmux で実際にプロセスが死ぬかは実機確認」と
   書いていた箇所を、初めて実際に踏んだ
2. ⛔ **フォーカス後始末が効いていなかった。** 2行あって1行目をフォーカスして終了すると、
   **残っている行があるのに `<body>` に落ちた**。proposal §4-4 が明示的に警告していた事象
3. ⚠ **ネイティブメニューが実際に描画されるところは観測できない**（`known-issues` 9番）。
   CDP は Renderer の中しか見えず、`screencapture -x` も画面収録の権限が無く失敗した

### 教訓（該当する場合）

- ⭐⭐ **フォーカス後始末に関門を作らせなかったのは、私（メイン）の分解ミス。**
  W2 に「実装せよ」と指示しただけで「赤くなる検査を先に書け」と言わなかった。
  loop.md の「変えようとしているものに、そもそも関門があるかを先に確かめる」は
  **委譲するときにワーカーへ引き渡さないと消える**
- ⭐ **W2 が直したバグは、私が実機で踏んだものとは別だった。**
  実機で踏んだのは「2行 -> 1行」だが、W2 の E2E ではそこは修正前から緑で、
  test で再現できたのは「節がまるごと消える」側。**フォールバック先の
  `.task-group__heading` は最後の行と同じコミットで消えるので、最初から到達不能な
  デッドコードだった**。逃がし先を常に存在する `<h2 class="panel-scope">` に変えた
- ⭐ **W2 は「前レンダーのスナップショットとの差分」機構ごと捨てた**（`previousSectionsRef` の
  削除）。私の3つの仮説はどれも当たっていなかったが、**仮説が指していた「タイミング依存」
  という性質そのものが正しかった**。いまの effect は今回のレンダーの `groups` / `recoverable`
  だけを読むので、何回どのタイミングで走っても結論が変わらない
- ⚠ **ワーカーの「spec の不備です」を鵜呑みにしない。** W2 の診断（`.length` が構造的に 1）は
  正しかったが、**提案された直し方には別の欠陥があった**（恒真化）。診断と処方は別に検証する
- **`Sidebar.tsx` は許可リストに無かったが W2 が触った。** props チェーンの中継3行で、
  ロジック変更なし。**報告してきたので許容**（黙って広げたなら差し戻していた）

### 検証

- `make check` 緑（**854件**）/ `make e2e-lint` **FAIL=0**（PASS=919）/ `lint-skills.sh` FAIL=0
- `npx playwright test S113 S114 S115` **3本とも green** / 近傍（S12 / S104 / S105 / S111 / S112）**5本 green**
- **実機で再確認済み**: 2行 -> 1行で残った行にフォーカスが移り、節が空になると
  `h2.panel-scope`（`tabIndex=-1`）へ移る。`<body>` には落ちない
- ⚠ **フル `make e2e` は未実施**（push 直前に回す）
- `docs/images` は未判定（周7 の撮り直しと同時に見る）

### 次に再開するとき最初に読むべきこと

- **周1〜5 と 6-a は完了。6-a は未コミット。** 次は **周6-b**（メニューバーのキーボード経路）
- ⭐ **6-b の土台はもう入っている。** `App.tsx` の `killTargetSessionIdRef` は
  右クリックと `onFocus` の**両方**から更新されるので、「最後にフォーカスした行」が
  そのまま「選択中」になる。**6-b で足すのは、メニュー項目と
  `IpcSend.menuKeepableAgentCount` と同型の有効/無効の配線だけ**
- ⚠ **ラベルの「選択中」は画面に選択という表現が無いまま語だけ出る。**
  IA 観点で引っかかる可能性があるので、6-b の計画ゲートで design-review を差し込むか判断する
- ⛔ 6-b で `registerAccelerator: false` を付けない / ショートカットは割り当てない
  （`Cmd+Shift+W` は「ウィンドウを閉じる」で埋まっている）
- そのあと 周7（`errorKind: 'tmux-unavailable'` + パネル単位の理由 + **8枚撮り直し**）
- `known-issues.md` に3件追加（7番: README の画像に押せる行が写っていない /
  8番: 巻き添え死ガードが沈黙する / 9番: ネイティブメニューの実描画が観測不能）

---

## 2026-08-09 - 周6-b + 周7: キーボード経路と、押せない理由（Issue 完了）

### 周6-b: メニューバー `ファイル > 選択中の AI を終了`

- `IpcSend.menuKillableAgentPresent`（**`boolean`**）を新設し、`updateKeepAgentsEnabled()` と
  同じ形で `enabled` を切り替える
- ⭐ **新しい `AppAction` は要らなかった。** 6-a の `kill-agent-session` をそのまま送れば、
  同じ `killTargetSessionIdRef` に効く。**6-a で「右クリックと `onFocus` の両方で
  ref を更新する」ようにしておいたことが、そのまま 6-b の土台になった**
- `TaskList.tsx` の `onTargetSession` を `(id: string | null)` に広げ、
  **6-a のフォーカス後始末 effect の中から**対象の消失を通知する（2つ目の監視機構を作らない）

#### 設計判断

- **payload を `number` ではなく `boolean` にした。** 既存の `menuPaneCount` /
  `menuKeepableAgentCount` は件数だが、**この操作の対象は常に0件か1件**。
  件数にすると「複数を同時に終了できる」と誤読させる
- ⛔ **ショートカットを割り当てない。** `Cmd+Shift+W` は「ウィンドウを閉じる」で埋まっており、
  `matchShortcut()` が素通しするキーを新たに奪うと**端末入力を奪う破壊的変更**になる
- ⛔ **無効時も非表示にしない**（項目の位置が動くと学習が壊れる。design-review 4/4 一致）

#### ⭐ ラベルの「選択中」について design-review を差し込まなかった判断

計画ゲートで「画面に選択という表現が無いまま語だけ出る」ことを IA 観点の懸念として挙げたが、
**5ペルソナのレビューは回さなかった**。根拠:

1. キーボードで辿っている行には **`button:focus-visible` の白 2px リング（18.42:1）**が既に出る。
   「選択中」がどれかは**見えている**
2. マウスしか使わない人はメニューバーではなく**右クリック**を使う（6-a で入れた）。
   この項目に到達するのはキーボード利用者だけ
3. ラベル `選択中の AI を終了` は proposal §2-E' として**5人が既に見ている**

### 周7: 押せない理由（パネル単位）

#### ⭐ 計画ゲートで見つかった、proposal と実コードのずれ（9件目）

| proposal §2-F' | 実際 |
|---|---|
| 「Main が `AgentTasksEvent.errorKind` に `'tmux-unavailable'` を返す」 | ⛔ **混ぜられない。** `errorKind` は既に `'not-found' \| 'timeout' \| 'failed'` で、**`claude agents --json` の失敗**を表す。tmux の可用性とは**軸が違い、両方同時に起きうる**ので1つの値では表せない |

-> **`AgentTasksEvent.tmuxUnavailable?: boolean` を別フィールドとして新設した。**

#### ⛔ 完了条件の字面を外した: 「押せない**行に**理由が出る」-> パネル単位

理由は `overview.md` の §2 に3点まとめた（5/5 の判断 / `ownedByApp` が再起動で嘘になる /
README 最初の画像の全行が「操作できません」になる）。
loop.md の作法どおり**コード（`TaskList.tsx` の分岐）・純粋関数（`tmuxUnavailableCopy.ts` 冒頭）・
テスト台帳（`scenarios.yml` の S117 note）の3箇所**に理由を書いた。
⛔ **Issue を close するときの書き戻しにも1行入れること。**

#### 設計判断

- **tmux の可否は起動時に1度だけ評価してキャッシュする。** `isTmuxAvailable()` は
  `spawnSync` なので、**3秒周期のポーリングから毎回叩いてはいけない**
  （`known-issues` 3-a 番と同じ「頻度が違うものに同じ作法を写す」罠）
- ⛔ **設定で無効（`useTmux: false`）のときは出さない。** それは利用者の意図であって異常ではない。
  **この分岐があるおかげで撮影レーン（既定 `useTmux: false`）の画像が1枚も動かなかった**
- ⛔ **文言で `tmux` を主語にしない。** `PERSIST_SETTING_LABEL` を `closeTabCopy.ts` から
  export して唯一の正にした。proposal の文案「…に必要な **tmux** が見つかりません」は
  この規約に違反していたので「必要なもの」に置き換えた

### 関門が赤くなることの証明

| spec | 壊し方 | 出た赤 |
|---|---|---|
| S116 | メニュー項目を常に有効にする | `Expected: false / Received: true`（否定側） |
| S116 | 対象消失時の `null` 通知を消す | 同上（**終了後に無効へ戻らない**側で落ちる） |
| S117 | 常に出す | `toHaveCount` `Expected: 0`（否定側） |
| S117 | 一度も出さない | `toHaveCount` `Expected: 1`（肯定側） |
| S117 | **設定の有効無効を見ない** | `toHaveCount` `Expected: 0`（`useTmux: false` の否定側） |

### 教訓（該当する場合）

- ⭐ **前の周で「次の周が使う」と決めて置いた ref が、本当にそのまま使えた。**
  6-a で `killTargetSessionIdRef` を右クリックと `onFocus` の両方から更新し、
  コメントに「周6-b がここを使う」と書いておいた。6-b で足したのは**メニュー項目と
  有効/無効の配線だけ**。⭐ **「次の周のために何を置いておくか」を書き残すと、周が安くなる**
- ⭐ **proposal が指定したフィールド名をそのまま使うと壊れる場合がある。**
  `errorKind` に値を足す案は、**そのフィールドが別の軸を表していた**ので成立しなかった。
  計画ゲートの「実コードで測り直す」は**フィールド名レベルでも効く**
- ⭐ **「画像が8枚動く」という予測が外れて0枚になった。** proposal §5 は周7 を「8枚」と
  見積もっていたが、それは**行単位で語を出す前提**。パネル単位に絞り、かつ
  「設定で無効なら出さない」分岐を入れたことで、撮影レーン（既定 `useTmux: false`）の
  条件を1つも踏まなくなった。**非目標を1つ足すと画像コストが消えることがある**
- ⚠ **S117 の前提（ハーネスの制限 PATH に実 tmux が無い）は spec 内で assert していない。**
  ただし前提が崩れた場合は**赤くなる側**に倒れる（メッセージが出ず肯定側が落ちる）ので、
  loop.md が警告する「関門を飛ばす側に倒れる」形ではない。doc に前提を明記して受け入れた
- ⚠ **`make e2e` 直後の S105 は flaky に出たが、単独 `--repeat-each=5 --retries=0` で
  全緑（各 1.7 秒）。** フルセット 4.8 分の直後で負荷が残っていただけ

### 検証（Issue #244 全体の最終確認）

- `make check` **858件緑**（54 -> 55 ファイル）
- `make e2e` フル **123 passed / 0 failed / 5 flaky**（S105 / S44 / S59 / S72 / S99。
  顔ぶれは実行のたびに変わる = 負荷起因。S105 は単独5回すべて緑で切り分け済み）
- `make e2e-lint` **FAIL=0**（PASS=935）
- `make e2e-screenshots-check` **PASS=39 / FAIL=0**（13枚すべて画素差 0 = **周6・7 で画像は動かない**）
- `lint-skills.sh` FAIL=0
- ⚠ `make css-substitution-check` は**周5 で意図的に落ちる**（値の変更を伴う周）

### 次に再開するとき最初に読むべきこと

- ⭐ **Issue #244 の完了条件はすべて達成した。実装・検証・文書は完了。**
  **周1〜5 はコミット済み、周6-a / 6-b / 7 が未コミット**
- **残るのはユーザーの判断だけ**（`overview.md` の §4）:
  1. commit / push / PR（⛔ エージェントは明示指示なしにやらない）
  2. Issue への書き戻し。⛔ **完了条件の字面を外した理由を1行入れる**
  3. `known-issues.md` の未対処5件を起票するか
- ⛔ **push 前にマシンが空いている状態でフル `make e2e` を回し直すこと**（今回の5 flaky）

---

<!-- 以降、作業のたびにセクションを追記 -->
