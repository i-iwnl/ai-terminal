# Known Issues

実装中に発見された未解決のバグ・先送りした課題。
詳細な観察記録は `worklog.md` を参照。

---

## 1. `Cmd+Shift+W` は「使わない」と明文で決まっているのに、Issue の提案がそれを使っている

### 症状

Issue #244 の提案「補助なし本命」の表に `Cmd+Shift+W`「タブを閉じて AI を残す」とある。
しかし `src/renderer/src/lib/shortcuts.ts` と `src/main/menu.ts` の**両方**に
「`Cmd+Shift+W` は macOS 全域で『ウィンドウを閉じる』と学習されているので使わない」というコメントがある。
`Cmd+Option+Shift+W` も `matchShortcut()` の `if (e.altKey) { if (e.shiftKey) return null; }` で明示的に不使用。

### 原因（判明している場合）

Issue の起票時に既存の決定を確認していない。loop.md の計画ゲートが言う
「計画書の前提が実コードとずれていた」の8件目。

### 影響範囲

- 完了条件の2件目「『タブを閉じて AI を残す』の明示的な導線」の実現方式

### 対処方針

- [ ] ユーザー判断を仰ぐ（メニューのみ / `Cmd+Option+Shift+W` / 既存決定を覆す）

### 優先度

P1

### ステータス

**対処済み**（2026-08-09。ユーザー判断: メニュー項目のみ・ショートカット無し。
あわせて `ウィンドウを閉じる Cmd+Shift+W` を本来の macOS の用途で新設することになった）

---

## 2. 偽 tmux（`e2e/fixtures/bin/tmux`）が `kill-session` にも `attach-session` にも応答しない

### 症状

Issue は「偽 tmux で観測できる」と書いているが、シムが実装しているのは
`list-panes` / `list-sessions` / `new-session -A -s <name> -- <cmd...>` の3つだけ。
`kill-session` を送っても何も起きず、記録も残らないため E2E から観測できない。

`attach-session` も未実装のため、**S104 の「タブに戻す」は一覧の見た目までしか見ていない**
（実際にアタッチできるかは検証されていない）。シム自身が冒頭で
「`-A` の分岐（既存なら attach）を検証していない」と明記している。

### 原因（判明している場合）

これまでアプリ側が `kill-session` を1度も呼んでいなかったため。

### 影響範囲

- 完了条件の1件目「tmux セッションごと終了し、`tmux ls` から消えることを E2E で固定する」

### 対処方針

- [ ] シムに `kill-session -t <name>` を実装し、受けた名前を記録ファイル（例 `tmux-killed-sessions.txt`）へ追記する
- [ ] あわせて `list-panes` の応答から該当行を落とし、「一覧から消える」まで観測できるようにするか検討する

### 優先度

P0（周1の前提）

### ステータス

**対処済み**（2026-08-09。周1 でシムに実装。記録は `tmux-killed-sessions.txt`）

---

## 3-a. `killTmuxSession()` を `spawnSync` で書いたのは誤り（自分で作り込んだ）

### 症状

周1 で追加した `killTmuxSession()`（`src/main/pty/tmux.ts`）が `spawnSync(..., { timeout: 3000 })`。
**「タブを閉じる」は1日に何十回もあるホットパス**で、`Cmd+Option+W` は分割中のペインを一度に閉じる。
tmux サーバがハングすると **Main プロセスが最大 3秒 × ペイン数ブロックし、その間ほかのタブの
PTY 入出力も全部止まる**（Renderer は Main 経由でしか PTY に触れない）。

### 原因

`isTmuxAvailable()` / `ensureTmuxUpdateEnvironment()` の作法（`spawnSync`）を写したが、
**あの2つは起動時に1度だけ**呼ばれるのでブロックが問題にならない。**頻度が違うものに同じ作法を写した。**

### 影響範囲

- タブ・ペインを閉じるすべての経路

### 対処方針

- [ ] `src/main/pty/cwd.ts` の `runLsof()` と同じ**非同期 `execFile` + timeout** に置き換える（前例あり）

### 優先度

P0

### ステータス

**対処済み**（2026-08-09。非同期 `execFile` + timeout に置き換え。
あわせて code-review の指摘で `env` の受け渡しと失敗時のログも足した）

---

## 3. Main プロセスが tmux セッション名を1つも保持していない

### 症状

`src/main/pty/manager.ts` の `PtyEntry` は `{ pty: IPty; sender: WebContents }` のみ。
`agentSessionId` / `wrappedInTmux` は `SpawnPtyResult` として Renderer に返され、
`PaneLeaf`（`src/renderer/src/tabs/paneTree.ts`）だけが保持している。
このため `pty:kill` を受けた Main は「この ptyId がどの tmux セッションか」を引けない。

### 原因（判明している場合）

これまで Main 側が tmux セッションを名指しで操作する必要が無かったため（作るのは
`wrapCommandWithTmux` が argv を組むだけ、読むのは `tmux list-panes -a` の全件走査）。

### 影響範囲

- 周2の実装方式そのもの

### 対処方針

- [ ] `entries.set(ptyId, ...)` の時点で tmux セッション名（または `agentSessionId` + `wrappedInTmux`）を一緒に持たせる
- ⛔ `listLiveAgentSessions()` の `pane_pid` と `entry.pty.pid` で突き合わせる案は**採らない**。
  `entry.pty.pid` は **tmux クライアントの pid** であってペイン内プロセスの pid ではないので当たらない

### 優先度

P0（周2の前提）

### ステータス

**対処済み**（2026-08-09。ただし `PtyEntry` の中ではなく **`entries` とは別の Map**。
code-review の指摘で「PTY と tmux セッションは寿命が違う」ことが分かったため）

---
## 4. tmux コマンド全般が、セッションを作ったときと違う env で実行されている

### 症状

`listLiveAgentSessions()` / `listLiveAgentSessionIds()` / `isTmuxAvailable()` /
`ensureTmuxUpdateEnvironment()` は、いずれも Main の素の `process.env` で tmux を叩く。
一方セッションを**作る**側（node-pty）には `mergeUserEnv(process.env, loginShellEnv())` が渡っている。

**`~/.zshrc` で `TMUX_TMPDIR` を設定している利用者では、読む側と書く側で別のサーバを見る。**

### 原因

`shellEnv.ts` の仕組み（GUI 起動の .app は `~/.zshrc` の値を1つも持たない）が入る前からある構造。

### 影響範囲

- タスク一覧の「タブに戻せる AI」（一覧が空になる）
- `#244` の `killTmuxSession()`（**この1つだけは 2026-08-09 に env を渡す形へ直した**）

### 対処方針

- [ ] `tmuxSessions.ts` の2つと `tmux.ts` の2つにも同じ env を渡す
- ⚠ `isTmuxAvailable()` は `which tmux` なので PATH だけの問題。`shell-path.ts` が既に効いている可能性がある（要実測）

### 優先度

P2

### ステータス

未対処（`#244` の周の範囲外。code-review 2026-08-09 で発見）

---

## 5. 「ウィンドウを閉じる」という第3の層が扱われていない

### 症状

`app.on('window-all-closed')` は **darwin では `app.quit()` を呼ばない**ので、
**赤信号ボタンでウィンドウを閉じても `before-quit` は発火せず `disposePtyAll()` も走らない**。
タブ構成はどこにも永続化していないため、赤信号1回で全タブが消え、Main の `entries` に
宛先の死んだ PTY が残る。

「タブを閉じる = 終了 / アプリを閉じる = 残す」の二分法に、**中間層が抜けている**。

### 影響範囲

- メニューバーに「ウィンドウを閉じる」が1つも無い（macOS で唯一の到達手段が赤信号ボタン）

### 対処方針

- [x] ユーザー判断: **`ファイル > ウィンドウを閉じる Cmd+Shift+W` を周3 で追加する**（意味は「残す」）
- ⚠ `shortcuts.ts` と `menu.ts` の「`Cmd+Shift+W` は使わない」コメント2箇所を、
  **理由付きで書き換える**（「macOS 全域でウィンドウを閉じると学習されている」が、
  そのまま**本来の用途に使う**理由になる）

### 優先度

P1

### ステータス

対応予定（周3。design-review の macOS ペルソナが発見）

---

## 6. `listLiveAgentSessionIds()` が事実上のデッドコード

### 症状

`src/main/pty/tmuxSessions.ts` の `listLiveAgentSessionIds()` は `src/` `test/` `e2e/` `scripts/`
のどこからも呼ばれていない。それでいて `test/unit/tmux-sessions.test.ts` が7件テストしている
（**実行されないコードに7件のテストが付いている**）。

`tmux list-sessions` を叩く唯一の関数なので、消すと `e2e/fixtures/bin/tmux` の
`list-sessions` 分岐と `tmux-live-sessions.txt` フィクスチャも不要になる
（`grep -rn "tmux-live-sessions" e2e/` の結果は偽 tmux 自身の2行だけ = **どの spec も書いていない**）。

### 対処方針

- [ ] 消す。⚠ ただし `parseLiveAgentSessionIds` は `buildTmuxSessionName` との往復を固定しているので、
  同等の検査を `parseLiveAgentSessions` 側へ移してから

### 優先度

P3

### ステータス

未対処（`#244` の周の範囲外。design-review の保守ペルソナが発見）

---

## 7. README の `S12-task-list.png` に「押せる行」が1行も写っていない

### 症状

周5 で README に「**押せる行には左端に細い縦線が出る**」と書いたが、その直上にある
`docs/images/S12-task-list.png` には**押せる行が1行も無い**（撮影レーンの既定フィクスチャは
`useTmux: false` なので `recoverable` が `undefined` になり、タブも開いていないため
`resolveTaskRowAction` が全行で `'none'` を返す = 全部 `<div>`）。

**文章が言っている手がかりが、隣の画像では1本も見えない。**

### 影響範囲

- README「5. 実行中タスクを一覧で見る」の本文と画像の整合

### 対処方針

- [ ] **周7（8枚撮り直し）と同じ周で判定する。** 撮影シナリオで tmux 側に1本生かして
  押せる行を作るか、それとも文章側を画像に合わせるか
- ⛔ `e2e/fixtures/harness.ts` の既定フィクスチャは変えない（E2E 7箇所 + README 画像8枚が動く）。
  変えるなら撮影 spec の中だけで `tmux-live-panes.txt` を書く（S112 と同じやり方）

### 優先度

P2

### ステータス

未対処（2026-08-09・周5 で発生させたもの）

---

## 8. 巻き添え死ガードに引っかかったとき、利用者には何も伝わらない

### 症状

`ipcMain.handle(IpcInvoke.agentSessionKill, ...)`（周6-a で新設）は、他の生きた PTY が
同じ tmux セッションを使っている場合、**終了させずに `console.info` を出して黙って return する**。
戻り値は `void` なので、**Renderer は「終了できなかった」ことを知る手段が無い**。

利用者から見ると「行を右クリックして『この AI を終了』を選んだのに、何も起きない」。

⚠ **同じ構造が `ptyKill` 側（周2）にもある**が、あちらは「タブは閉じる」という
目に見える結果が伴うので沈黙が問題になりにくい。**一覧からの終了は、成功しても失敗しても
画面が変わらない**（成功した場合は次のポーリングで行が消えるが、それも3秒後）。

### 影響範囲

- タスク一覧からの終了（周6-a）
- ⚠ ただし**踏む条件は狭い**。対象は `resolveTaskRowAction` が `'recover'` を返す行 =
  タブが開いていない行なので、そもそも共有している状況が起きにくい

### 対処方針

- [ ] `agentSessionKill` の戻り値を `Promise<'killed' | 'shared' | 'not-found'>` のような
  結果型にし、Renderer が通知バナーへ落とす
- ⚠ ⛔ **`ptyKill` の戻り値は変えないこと**（あちらは同期ハンドラで、`await` を挟むと
  閉じるたびに終了バナーが出て Dock が跳ねる。理由の唯一の正は `manager.ts` のコメント）

### 優先度

P2

### ステータス

未対処（2026-08-09・周6-a のレビューでメインが発見）

---

## 9. ⭐ 実機で「ネイティブメニューが実際に描画されるところ」を観測する手段が無い

### 症状

周6-a で足した「一覧の行の右クリックメニュー」は、E2E では
`Menu.prototype.popup` をスパイに差し替えて**中身だけ**を見ている（S91 / S113 / S114）。
**本物のメニューが画面に出るところは、一度も観測されていない。**

`agent-browser`（CDP）は Renderer の中しか見られず、OS のウィンドウは写らない。
`screencapture -x` も試したが `could not create image from display`（画面収録の権限が無い）。

### 影響範囲

- 周6-a の右クリック導線
- ⚠ ただし**機構は既存の `S91-terminal-context-menu.spec.ts`（ターミナル面の右クリック）と同一**で、
  そちらは実際に使われている。`Menu.buildFromTemplate().popup()` の2つ目の利用にすぎない

### 対処方針

- [ ] 人が1度、実際に右クリックしてメニューが出ることを見る
- ⚠ **これはエージェントには原理的に不可能**。#195（人力でしか進められないもの）に
  載せるかは、周6 を閉じるときにユーザーが判断する

### 優先度

P3

### ステータス

未対処（2026-08-09・周6-a の実機確認で判明）

---
