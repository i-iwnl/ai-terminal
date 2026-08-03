# Issue #121 P3 - Architecture

触る構造・Contract 変更・設計判断。**時系列は `worklog.md`、未解決は `known-issues.md`。**

---

## 1. 対象トラック

単一トラック。ただし触る層は3つに分かれる。

| 層 | 触るもの | 該当する周 |
|---|---|---|
| renderer | `tabs/TabBar.tsx` / `tabs/useTabs.ts` / `tabs/paneTree.ts` / `styles.css` | 周2・周3 |
| main | `pty/manager.ts`（`generateId` の注入口）/ `pty/cwd.ts`（調査のみ） | 周4・周5 |
| e2e | `screenshots.spec.ts` / `fixtures/harness.ts` / `scripts/lint-e2e.mjs` / `specs/` | 周1・周3・周4 |

---

## 2. スキーマ / Contract 変更

### 周2: `wrappedInTmux` を Renderer の状態に載せる

**`src/shared/ipc.ts` は変更しない。** `SpawnPtyResult.wrappedInTmux` は既に存在し、
Main から Renderer まで返っている。**捨てているのは Renderer 側だけ**なので、
変えるのは `src/renderer/src/tabs/paneTree.ts` の `PaneLeaf` に
`wrappedInTmux?: boolean` を足すところまで。

```
Main: maybeWrapWithTmux() -> SpawnPtyResult.wrappedInTmux   （既存・変更なし）
                                    |
Renderer: spawnLeaf() が受け取る    <- ここで捨てている（変える）
                                    |
          PaneLeaf.wrappedInTmux    <- 足す
                                    |
          TabBar のバッジ           <- 足す
```

`TabState` ではなく `PaneLeaf` に置く理由: tmux ラップは **PTY 1本ごとの属性**で、
タブ（= ペインの木）の属性ではない。分割すると1タブの中に
「tmux でラップされた claude」と「素の zsh」が同居しうる。
`exit` / `agentSessionId` / `cwd` と同じ層。

### 周4: セッション UUID の固定（採る場合）

`buildClaudePlan(req, config, generateId: () => string = randomUUID)` の
**注入口は既に存在する**。`registerPtyHandlers()` が渡していないだけ。
**製品コードに新しい分岐を足さずに済むかどうか**が判断の分かれ目。

---

## 3. 設計判断

### 判断1: A-1 は「実装する」ではなく「関門を作る」（周1）

Issue 本文のチェックボックス1つ目（`max-width` と `min-width: 0` を足す）は
**既に実装済み**だった（`Issue #67:` のコメント付きで `styles.css` に残っている）。

残っているのは2つ目「最小幅での見え方を E2E かスクリーンショットで確認する」。
loop.md「**変えようとしているものに、そもそも関門があるかを先に確かめる**」の型で、
**`max-width` を消して赤くなるか**を先に見る。赤くならなければ関門を作る。

**この周は値を1つも変えない**（loop.md「関門を作る周は、値や振る舞いを1つも変えない」）。

### 判断2: A-2 の本質は「数を人が書き写す形をやめる」（周1）

Issue 本文は「11 と書いてあるが実際は12」と言うが、**現物は 13 で一致している**。
つまり**誰かが手で直した**ということで、次にシナリオが増えたらまた同じずれが起きる。

同じファイルに**より悪い記述**がある。冒頭が「通常の `make e2e` には含まれない」と書き、
下方の `AI_TERMINAL_E2E_IMAGES_DIR` のコメントが「`make e2e` からもこの spec を
回せるようにするため」と書いている。**1ファイル内で自己矛盾している。**

### 判断3: タブ死角の修正は D&D とコンテキストメニューへ波及しない（周3）

P2 の known-issues は「TabBar.tsx の構造変更になり、D&D・改名・コンテキストメニューへの
波及確認が要る」としてスコープから外していたが、**D&D もコンテキストメニューも実装が無い**
（`draggable` / `onDragStart` / `onContextMenu` が src 全体で 0 件）。
波及先は**ダブルクリック改名だけ**。

---

## 4. 読むべき規約

| 対象範囲 | 読むもの |
|---|---|
| タブの当たり判定・バッジの見た目 | [/design-review](../../skills/design-review/reference/design-rules.md) |
| E2E シナリオの追加・撮影レーン | [/e2e](../../skills/e2e/SKILL.md) |
| tmux ラップ・PTY | [/terminal](../../skills/terminal/SKILL.md) |
| `claude` の起動引数・`agents --json` | [/ai-cli](../../skills/ai-cli/SKILL.md) |
