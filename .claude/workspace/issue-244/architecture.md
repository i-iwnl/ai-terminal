# Architecture

Issue #244 における変更対象の構造。
設計判断の根拠は末尾の「設計判断履歴」を参照。

---

## 0. 着手前に実測した現状（2026-08-09）

Issue 本文の記述を実コードで測り直した結果。**Issue が触れていない前提が3つ**あり、周の切り方に直接効く。

### Issue の記述の照合

| Issue の記述 | 実測 | 判定 |
|---|---|---|
| `src/shared/defaults.ts:60` が `useTmux: true` | 60行目で一致 | ✅ |
| `closeTabCopy.ts:264-268` が確認を出さない理由 | `needsCloseConfirmation` の JSDoc 内。行はほぼ一致 | ✅ |
| `TaskList.tsx:225` で `taskRowActionLabel()` が `aria-label` の中でしか使われていない | `renderTask()` 内で一致。画面には1文字も出ていない | ✅ |
| ホバー `--surface-2` #222222 対 `--surface-0` #141414 | `:root` の値と一致 | ✅ |

### ⭐ Issue が触れていない前提（周の切り方に効く）

| # | 事実 | 効き方 |
|---|---|---|
| **A** | **Main は tmux セッション名も `agentSessionId` も持っていない。** `PtyEntry` は `{ pty, sender }` のみ。`agentSessionId` / `wrappedInTmux` は `SpawnPtyResult` で Renderer に返され、`PaneLeaf`（`paneTree.ts`）だけが保持している | 「閉じたら tmux セッションも殺す」を実装するには、まず Main 側に保持させる（または Renderer から渡す）ところから要る |
| **B** | **`Cmd+Shift+W` は「使わない」と明文で決まっている。** `shortcuts.ts` と `menu.ts` の**両方**に「macOS 全域で『ウィンドウを閉じる』と学習されているので使わない」というコメントがある。`Cmd+Option+Shift+W` も `if (e.altKey) { if (e.shiftKey) return null; }` で明示的に不使用 | Issue の提案する `Cmd+Shift+W`「タブを閉じて AI を残す」は**既存の決定と正面衝突する**。ユーザー判断が要る |
| **C** | **偽 tmux（`e2e/fixtures/bin/tmux`）は `kill-session` にも `attach-session` にも応答しない。** 実装するのは `list-panes` / `list-sessions` / `new-session -A -s ... -- ...` の3つだけ | 「E2E で固定する」には**先にシムを拡張する**必要がある。シム側で `kill-session` を受けたら記録ファイルに書く形にすれば、E2E から観測できる |

### 現状の「閉じる」経路（実測）

| 起点 | 合流先 | `needsCloseConfirmation` を通るか |
|---|---|---|
| `Cmd+W` / メニュー「ペインを閉じる」/ 右クリック | leaf 1枚なら `requestCloseTab`、2枚以上なら `closeActivePane()` | **1枚のときだけ** |
| `Cmd+Option+W` / メニュー「タブを閉じる（N ペイン）」 | `requestCloseTab` | 通る |
| タブバーの x / タブ上で Delete・Backspace | `requestCloseTab` | 通る |
| 分割の失敗ロールバック（`splitActivePane`） | `pty.kill()` を直接 | 通らない |
| **アプリ終了（`before-quit`）** | `disposePtyAll()` → 全 `entry.pty.kill()` | 通らない |

すべて最終的に `window.api.pty.kill(ptyId)` → `IpcInvoke.ptyKill`（`pty:kill`）→ `entry.pty.kill()` + `disposeEntry()`。
**`disposeEntry` は tmux に一切触らない。** ここが累積の発生源。

⛔⛔ **【2026-08-09 訂正】この節に初版で書いた「`before-quit` の `disposePtyAll()` は同じ
`pty:kill` の経路を通る」は誤り。** design-review の IA / macOS の2人が独立に指摘し、
`src/main/pty/manager.ts` を読み直して確認した。

- `ipcMain.handle(IpcInvoke.ptyKill, ...)` は `entries.get()` → `entry.pty.kill()` → `disposeEntry()`
- `disposePtyAll()` は **`entries` を直接回して `entry.pty.kill()` を呼ぶ独立関数**で、IPC ハンドラを経由しない

**つまり2つの経路は既に分かれている。** `ptyKill` ハンドラの中で tmux セッションを終了させても、
`before-quit` の挙動（生き残る）は自動的に維持される。**周2 だけなら Contract 変更は要らない。**

⭐ **ただし macOS には第3の層がある**（macOS レビュアーの指摘。`src/main/index.ts` で確認）。
`app.on('window-all-closed')` は **darwin では `app.quit()` を呼ばない**ので、
**赤信号ボタンでウィンドウを閉じても `before-quit` は発火せず `disposePtyAll()` も走らない**。
「タブ = 終了 / アプリ = 残す」の二分法に、**ウィンドウという中間層が抜けている**。

### tmux を叩く既存コードの作法（新規に `kill-session` を足すとき踏襲する）

`isTmuxAvailable` / `ensureTmuxUpdateEnvironment`（`tmux.ts`）、`listLiveAgentSessions` /
`listLiveAgentSessionIds`（`tmuxSessions.ts`）の4箇所に共通:

- `spawnSync` を引数配列で直接呼ぶ（シェル経由にしない）
- **タイムアウトを必ず付ける**（`TMUX_TIMEOUT_MS = 3000`）
- **例外・非ゼロ終了で throw しない。安全側に倒す**
- コマンド組み立ては純粋関数に切り出し `test/unit/` で固定する
- 接頭辞 `aiterm-` を扱う正は2箇所だけ（付ける `buildTmuxSessionName` / 剥がす `SESSION_NAME_PREFIX`）

---

## 1. 対象トラック

main（PTY / tmux）+ renderer（React UI）の2トラック。

| コンポーネント | 変更内容 | 影響範囲 |
|---|---|---|
| `src/main/pty/tmux.ts` | 追加: `tmux kill-session` のコマンド組み立て（純粋関数）+ 実行 | `test/unit/pty-plan.test.ts` |
| `src/main/pty/manager.ts` | 変更: `PtyEntry` に tmux セッション名を持たせる / 閉じる経路で kill-session | `before-quit` の `disposePtyAll` は据え置き |
| `src/shared/ipc.ts` | **Contract 変更**（下記） | preload / useTabs / App.tsx |
| `src/renderer/src/tabs/useTabs.ts` | 変更: 閉じる経路で「終了する」意図を渡す | `closeTab` / `closeActivePane` / 分割ロールバック |
| `src/renderer/src/tabs/closeTabCopy.ts` | 変更: `needsCloseConfirmation` の `persistentOrphaned` 条件と確認文言の意味 | `test/unit/close-tab-copy.test.ts` / S62 / S90 |
| `src/renderer/src/sidebar/TaskList.tsx` / `taskRow.ts` / `styles.css` | 追加: 行の手がかり・終了ボタン・押せない理由 | **画素が動く**。`docs/images/` 8枚 |
| `e2e/fixtures/bin/tmux` | 追加: `kill-session` への応答と記録 | 新規シナリオの観測点 |
| `docs/PLAN.md` / `README.md` | 永続化の説明が変わる（**非互換な挙動変更**） | `test/unit/readme-commands.test.ts` |

---

## 2. Contract（src/shared/ipc.ts）変更

| チャンネル / 型 | 変更 | 内容 |
|---|---|---|
| `IpcInvoke.ptyKill` の引数 | ALTER | `string`（ptyId）→ 「tmux セッションごと終了するか」を伴う形。**`before-quit` は従来の意味のまま呼ぶ** |
| セッション終了の新チャンネル | ADD | タスク一覧から `agentSessionId` 指定でセッションを終了する（周3） |

**確定は周ごとの計画ゲートで行う。** ここは見込み。

---

## 3. 技術的制約・前提条件

- ルート CLAUDE.md 鉄則3: **IPC のチャンネル名と型は `src/shared/ipc.ts` を単一の正とする**
- ルート CLAUDE.md 鉄則5: 外部フォーマット（tmux の出力）のパース失敗でアプリを落とさない
- `tmux.ts` 冒頭のコメントが「claude / gemini の非対称」の唯一の正。**他所に書き写さない**
- ⛔ `e2e/fixtures/harness.ts` の既定フィクスチャを変えない（E2E 7箇所 + README 画像8枚が動く）
- ⛔ tmux の argv に環境変数の値を載せない（`ps` から読める）
- 偽 tmux は `-A` の分岐（既存なら attach）を再現しない。**「本当に元の画面へ戻る」は実機確認でしか出ない**

---

## 4. 周の分割（案・未確定）

| 周 | 内容 | design-review | 完了条件のうち |
|---|---|---|---|
| **1** | 偽 tmux に `kill-session` を実装し、**現状のコードで「閉じても tmux セッションが残る」ことを赤で観測する** E2E を追加。値も挙動も1つも変えない | 不要 | 「修正前のコードで赤くなることを確認した」の担保 |
| **2** | 閉じる経路で tmux セッションごと終了させる。`before-quit` は据え置き。確認文言の意味を直す | **要**（文言が変わる） | 1件目・3件目 |
| **3** | 「タブを閉じて AI を残す」の明示導線（メニュー / ショートカット） | 要 | 2件目 |
| **4** | タスク一覧の行の手がかり + 終了ボタン（IPC 追加） | 要 | 4・5件目 |
| **5** | 押せない行に理由を出す | 要 | 6件目 |

周1と周2を分けるのは loop.md の「関門と実装を分けたいなら、1本目を値も挙動も変えない置き換えにする」に従うため。
⛔ ただし**周1だけを main に入れない**（赤いまま push しない）。周1+周2 で1本の PR にする。

---

## 5. 設計判断履歴

| 日付 | 判断 | 根拠 | 代替案 |
|---|---|---|---|
| 2026-08-09 | tmux 永続化そのものは残す | Issue 側で実測済み（生きたセッションが36〜39行の画面を保持 / 一覧の11件中10件が正しく解決）。`docs/PLAN.md:143` の動機は**アプリ終了**の話であってタブを閉じる話ではない | 永続化を削除する（症状の側を消すだけ） |
| 2026-08-09 | `pty:kill` の意味を一律では変えない | `before-quit` の `disposePtyAll()` が同じ経路を通る。一律に変えると「アプリを閉じても生き残る」が壊れる | 呼び出し側で分岐せず Main 側で判定する（Main はどの経路から来たか知らない） |
| 2026-08-09 | Main 側に tmux セッション名を持たせる（`entries.set` の時点） | `PtyEntry` が `{pty, sender}` しか持たず、Main 単独では引けない。`listLiveAgentSessions()` から pid で突き合わせる案もあるが、`pty.pid` は **tmux クライアントの pid** でペイン内プロセスの pid ではないため当たらない | Renderer から `agentSessionId` を送る（Contract が太る） |
| 2026-08-09 | **「閉じて AI を残す」はメニュー項目のみ。ショートカットは割り当てない** | `Cmd+Shift+W` は shortcuts.ts / menu.ts の両方に「macOS 全域で『ウィンドウを閉じる』と学習されている」という明文の決定がある（前提 B）。**既存決定を覆す根拠が無い**。めったに使わない操作なのでメニューで足り、`Cmd+Option+W` の隣に並べれば発見可能性も確保できる（ユーザー判断・2026-08-09） | `Cmd+Option+Shift+W`（4キー同時で押しづらく、こちらも明示的に不使用と書かれている） / `Cmd+Shift+W`（誤爆リスク） |
| 2026-08-09 | **確認ダイアログは「2枚以上を一度に閉じる」だけ残す。`persistentOrphaned` の条件は外す** | 閉じたら終わるなら「拾えないプロセスが残る」という不可逆な事故が原理的に起きない。ホットパス（1枚を閉じる）に確認を増やさないのは Issue の明示方針（ユーザー判断・2026-08-09） | 確認を全廃 / AI が走っているペインは常に確認 |
