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

<!-- 以降、作業のたびにセクションを追記 -->
