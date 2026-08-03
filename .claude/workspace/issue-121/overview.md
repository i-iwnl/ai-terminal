# Issue #121 P3: 小さな不具合・検出漏れ・検証手段の穴 - Overview

> **Issue**: [#121 P3: 小さな不具合・検出漏れ・検証手段の穴（9 件を統合）](https://github.com/i-iwnl/ai-terminal/issues/121)
>
> 旧 #93 / #91 / #68 / #67 / #66 / #18 / #17 / #16 / #15 を畳んだ Issue。
> **各項目の調査記録は、統合元の Issue 本文が引き続き正**（クローズしても読める）。
>
> - `architecture.md` - 触る構造・Contract 変更・設計判断
> - `worklog.md` - 時系列の作業ログ・次に再開するとき最初に読むべきこと
> - `known-issues.md` - 判明した問題・未解決事項・先送りしたもの
>
> **最終更新**: 2026-08-03

---

## 1. ゴール

P1（#119）が「見た目と構造」、P2（#120）が「操作と当たり判定・ハーネスの穴」を埋めた。
P3 は **残った小さな不具合と、検証手段そのものが無い箇所**を片づける。

| カテゴリ | 対象 |
|---|---|
| 対象トラック | renderer（TabBar / SearchBar）+ main（pty / cwd / agents）+ e2e（撮影レーン・lint ハーネス） |
| ブランチ | 各周ごとに main から新規（スタック PR を作らない） |
| 前提 | P2 から4件が回されている（`.claude/workspace/issue-120/known-issues.md`） |

---

## 2. 着手前に実コードで測り直した結果（2026-08-03）

**Issue 本文の前提が4つ古くなっていた。** loop.md「計画書の現状認識は古くなる」の 15〜18 件目
（P1・P2 で 14 件）。

| # | Issue 本文の記述 | 実測 | 影響 |
|---|---|---|---|
| A-1 | 「`.terminal-search` は max-width を持たず細いペインからはみ出す。`max-width: calc(100% - var(--sp-4))` と `input { min-width: 0 }` を足す」 | **両方とも既に入っている。** `styles.css` の `.terminal-search` に `max-width: calc(100% - var(--sp-4))`（`Issue #67:` のコメント付き）、`.terminal-search input` に `flex: 1; min-width: 0`（同）。**実装は完了済み** | **残るのは「関門が無い」ことだけ。** チェックボックス2つ目「最小幅での見え方を E2E かスクリーンショットで確認する」が未達。壊しても赤くならない疑いがある |
| A-2 | 「コメントが『readme: true な11シナリオ』と書いているが実際は12件」 | **コメントは「13シナリオ」**で、`scenarios.yml` の `readme: true` は **13件**、`test()` も 13 個、`docs/images/*.png` も **13枚**。**数は現時点で一致している** | 数のずれは既に解消。**古いのは別の段落** —「通常の `make e2e`（testDir: ./e2e/specs）には含まれない。実行は `make e2e-screenshots`」が **P2 周5（D-1）で撮影レーンが第2 project になった事実と矛盾**。しかも同じファイルの下方に D-1 の説明が併記されており、**1ファイル内で自己矛盾している** |
| A-3 | 「`wrappedInTmux` が `useTabs.ts:80-88` で捨てられている」 | **一致。** `spawnLeaf()` が `result.ptyId` / `result.agentSessionId` だけを使い `result.wrappedInTmux` を参照していない。`TabState` / `PaneLeaf` のどちらにも相当フィールドが無い | そのまま着手可 |
| B-1 | 「tmux でラップしている場合、`lsof` が別プロセスの cwd を返す。**既定で tmux ラップが有効なので通常経路**」 | **半分ずれている。** `maybeWrapWithTmux()` は `req.kind === 'shell'` で**早期 return** するため、**シェルタブは tmux ラップされない**。一方 2秒ポーリング（`CWD_POLL_INTERVAL_MS`）は `leaf.ptyKind !== 'shell'` を除外するので、**ポーリング経路と tmux 経路は交わらない** | tmux の影響が出るのは `newAgentTab` / `splitActivePane` が**エージェントタブから cwd を引き継ぐとき**だけに絞られる。**「通常経路」は言い過ぎ** |
| B-1 | 「諦める場合は、ペインヘッダに cwd の basename を出して気づけるようにする」 | **既に出ている。** `paneHeader.ts` の `paneHeaderLabel(leaf)` が `` `${kindLabel}・${basename(leaf.cwd)}` `` を返す | **この作業項目は不要**。ただし出しているのは leaf に記録された cwd で、追跡値ではない |
| 項目1 | （P2 known-issues）「D&D・改名・コンテキストメニューへの波及確認が要る」 | **タブの D&D もコンテキストメニューも実装が存在しない**（`draggable` / `onDragStart` / `onContextMenu` はいずれも src 全体で 0 件）。`S58-drop-target-highlight.spec.ts` はタブではなく**ペインへのファイルドロップ**の検証 | **波及確認の対象は改名だけ。** タブ死角の修正コストは記録より小さい |

依然として正しい前提:

- `scripts/lint-e2e.mjs` の check9 は `existsSync()` のみ・**WARN で exit code に影響しない**（`process.exit(failCount > 0 ? 1 : 0)` が `warnCount` を見ない）
- `poller.ts` の `ownedSessionIds` は**プロセス内 Set で削除経路が無い**
- `S15-task-owned.spec.ts` は**否定側のみ**（spec の冒頭コメントが「positive case は検証不能」と書いたまま）
- `playwright.config.ts` は `retries: 1` / `timeout: 30_000` / `workers: 1`
- 起動 flake の実測値「99 起動中 2 回」は **3箇所**に残っている（`playwright.config.ts` / `e2e/fixtures/harness.ts` / `.claude/skills/e2e/operations/run-e2e.md`）

環境（B-2 の実装可能性に効く）:

- **Pillow 12.3.0 が使える。** ImageMagick（`compare` / `magick` / `convert`）は**無い**。`pixelmatch` / `pngjs` は `package.json` に**無い**
- `buildClaudePlan()` は `generateId: () => string = randomUUID` を**引数で受けている**（注入口は既にある）が、`registerPtyHandlers()` が渡していないので常に本物が使われる

---

## 3. 完成条件

### 周1: A-1 の関門と A-2 の記述是正 — **完了 2026-08-03**（`feat/issue-121-p3-r1`）

- [x] A-1: 細いペインで `.terminal-search` がペイン幅を越えないことを検査する関門を作った。**`max-width` を消すと左へ 26px で赤く**、**`min-width: 0` を消すと右へ 18px で赤く**なることを実際に確認した
- [x] A-1: **既存の関門が3つとも間違っていたことを実測で特定した**（測る場所 = ペインが広すぎた / 測る辺 = 右端は構造上越えない / 測る対象 = コンテナだけ見て中身のあふれを見ていない）
- [x] A-2: 撮影 spec 冒頭の「通常の `make e2e` には含まれない」を実態（第2 project として含まれる）に合わせた。**同じファイル内で自己矛盾していた**
- [x] A-2: **シナリオ数を人が書き写す形をやめた**（冒頭から数を消し、台帳を数えろと書いた）
- [x] **`src/` を1文字も変えていない**（loop.md「関門を作る周は、値や振る舞いを1つも変えない」）

### 周2: A-3 + C-3 — **design-review と実測でスコープが変わった**

**前半（完了 2026-08-03）: design-review と実測**

- [x] 5ペルソナのレビューを通した。**Issue 本文が名指しした「タブにバッジ」は 5/5 で却下**（`.tab-bar__drag-region` を削る / タイトル実幅がタブ幅−60px で8枚時 1.7桁 / コントラストに退路が無い / CLI の生語 / `ptyKind !== 'shell'` との同語反復）
- [x] 提案 D（通知バナー）も却下。`.notice-list` と `.terminal-search` は**上端が 1px も違わず**、`autoFocus` した検索欄を完全に覆う（WCAG 2.4.11）
- [x] **採用は提案 F**（検索バー内の `aria-describedby`）。macOS の D' と a11y の F が独立に同じ結論に到達
- [x] `brew install tmux`（3.7b）して**実測した**。tmux は**代替画面バッファを使う**（`?1049h` を確認）
- [x] **README / PLAN.md / pty-pitfalls.md の3箇所が実測と逆**であることを確定した（`known-issues.md` の 5）
- [x] **`CloseTabConfirmDialog` が既定構成で嘘をつく**ことを実アプリで確定した（`known-issues.md` の 4）

**後半（完了 2026-08-03）: 実装**

- [x] `PaneLeaf` に `wrappedInTmux` を持たせ、`spawnLeaf()` が捨てなくなった。**`config.useTmux` を読み直さない**（設定を後から切った人に嘘をつくため）
- [x] **閉じる確認ダイアログの文言を `wrappedInTmux` で分岐させた**。`closeTabCopy.ts`（純粋関数）+ `test/unit/close-tab-copy.test.ts` 13件。**分岐を潰すと新しい6件だけが赤くなる**ことを確認
- [x] 提案 F: 検索バーに `aria-describedby` のヒントを出した（**live region を1個も増やしていない**）
- [x] **README / PLAN.md / pty-pitfalls.md の3箇所を実測に合わせて書き換えた**（実測日 2026-08-03 と tmux 3.7b を併記）
- [x] 偽 tmux シムで E2E から tmux 経路を踏めるようにした。**S84** が配線を端から端まで踏む（**配線を外すと赤くなる**ことを確認）。既定 `fakeTmux: false` で既存シナリオの挙動は不変
- [x] C-3 の結論を `limitations.md` に書いた。**本物の tmux による自動検証は作らない** — tmux のサーバは `/private/tmp/tmux-<uid>/default` というプロセス横断の資源で HOME 隔離が効かず、テストが落ちると実物の claude / gemini がマシンに残る（gemini は回収不能）
- [x] **タブのバッジは作っていない**（5ペルソナが 5/5 で却下）

### 周3: タブの死角（P2 からの持ち越し 1）— **完了 2026-08-03**

- [x] `.tab-bar__tab` の死角が無くなった。**実測は 90px 中 38px（42%）**で、記録の 34px より大きかった
- [x] `.tab-bar__close` の左 10px の張り出しを再判定した。**結論は「残す」だが理由を差し替えた**（「隣が死角だから」→「閉じるボタンを狙って外した位置だから」）。`design-rules.md` に「『無害な向き』は、隣を直すと有害に変わりうる」として一般化
- [x] `S69` を中央 1点から**帯**へ拡張し、**`::before` を無効化すると 38px で赤くなる**ことを確認した

### 周4: B-2（撮影の中身の検出）+ `ownedByApp` の肯定側 — **完了 2026-08-03**

- [x] 非決定性を**発生源で3種類とも断った**（セッション UUID / カーソルの点滅 / 後から生える幅計測コンテナ）
- [x] `make e2e-screenshots-check` を追加した。**しきい値は実測で決定**（3回撮って最大チャンネル差 1 に対し、内容の差は 2237〜2608 画素・最大差 ~200）。依存を増やさず `zlib` だけで PNG をデコード
- [x] **known-issues 2 も同時に塞いだ**（撮られていないシナリオを check1 が検出する）
- [x] `S15` が `ownedByApp` の肯定側を検証するようになった（**別 UUID を書くと赤くなる**ことを確認）

### 周5: B-1 / B-3 の判断 + C の結論 + 締め — **完了 2026-08-03**

- [x] B-1: **追跡を足さない判断。** `lsof` は tmux クライアントの起動時 cwd を返すと実測したが、**`cd` するシェルタブは tmux ラップされない**ため実害のある経路が無い
- [x] B-3: **受け入れる判断。** 実測値を3箇所とも更新。**撮影レーンに `retries` が無かった**のを 1 に揃えた（flake で画像が1枚欠けていた）
- [x] C-1 / C-2 は `deferred` 維持、**C-3 は「本物の tmux による自動検証は作らない」判断**（隔離が原理的に効かない）
- [x] known-issues 6（1ペインの無言の孤児）も直した（**回収不能な tmux + gemini だけ**確認を出す）

### 全周共通

- [x] `make check` が通る（**466 PASS**）
- [x] **`make e2e` を P3 の最後に1回**実行した（**93 passed / 2 flaky**。flaky は2件とも既知の起動 flake）
- [x] `make e2e-lint` が `FAIL=0`（**PASS=671**）
- [x] `make e2e-screenshots-check` **PASS=38 FAIL=0** / `lint-skills.sh` **PASS=87 FAIL=0**
- [x] **Issue #121 へ書き戻した**（周1〜周5 の結果と、本文のずれ6件の訂正）

---

## 4. 現状進捗

| 項目 | 状態 |
|---|---|
| 設計 | 完了。周2 で design-review を通し、**Issue 本文の指示を却下して代案に差し替えた** |
| 実装 | **周1〜周5 すべて完了**（`feat/issue-121-p3-r1`。**未コミット**） |
| 検証 | `make check` **466 PASS** / `make e2e` **93 passed / 2 flaky** / `make e2e-lint` **PASS=671** / `make e2e-screenshots-check` **PASS=38 FAIL=0** / `lint-skills.sh` **PASS=87** |

---

## 5. 直近の次アクション

**P3（#121）は全5周を完了した。** 残っているのは commit / PR とクローズ判断だけ
（このワークスペースは open/close を操作しない方針）。

P2 から回された4件の行き先:

| P2 known-issues | #121 のどこへ |
|---|---|
| 1. タブ幅 90px 中 34px の死角 | **周3** |
| 3. 撮影レーンの非決定性（残り2枚 = セッション UUID） | **周4**（B-2） |
| 5. 起動 flake の発生率が記録より高い（6.4% 対 2.0%） | **周5**（B-3） |
| 6. `ownedByApp` の肯定側が検証可能になった | **周4** |
