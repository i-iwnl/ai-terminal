# Known Issues

実装中に発見された未解決のバグ・先送りした課題。
詳細な観察記録は `worklog.md` を参照。

---

## 棚卸し（2026-08-04）

**実コードで1件ずつ現状を測り直した結果**（main = 61edbe5 時点）。
`.claude/skills/workspace-plan/operations/promote-known-issues.md` の手順による。
**元の記述は観察の記録として残す。** 状態の唯一の正は GitHub Issue。

| 項目 | 判定 | 根拠 |
|---|---|---|
| 1. tmux ラップ時の cwd が実態と違いうる | **解決済み**（技術的事実は不変。「決めて明文化する」が完了） | `2814ca4` のコード側コメントと `538cb2b` の README（「tmux 経由で起動している場合、追跡できる cwd は tmux クライアント側のものになる」）。判断は #121 のクロージングコメントで「**追跡を足さない判断。実害のある経路が無いので OSC 7 も tmux 用の pid 解決も入れない**」と書き戻し済み |
| 2. ポーリング前提が分割表示（#56）で崩れる | **解決済み** | `e968aed`（#56 のマージと同時に対処）。`refreshTabCwd(tabId, ptyId)` が tabId と ptyId を別引数で取り、`flattenPaneTree(tab.layout).find(l => l.ptyId === ptyId)` で引き直す。依存配列に `activePaneIdForCwdPolling` が入っており、分割でアクティブペインが変わると張り直される。`setInterval` は1本のまま（lsof がペイン数に比例しない） |
| 3. 他セッションの git worktree を eslint が拾う | **解決済み** | `7d6d703`。`eslint.config.js` の `ignores` に `.claude/worktrees/**` が入っている（`e2e/report/**` と同型のコメント付き） |

**記述のずれ**: 1 番の「ポーリング対象を `kind === 'shell'` に限定しているため、この値は読まれない」は不正確。`newAgentTab()` は kind を問わず `pty.cwd()` を呼ぶ。ただし返る値が spawn 時 cwd と一致するため、結論（実害なし）は変わらない。

---


## 1. tmux でラップしたエージェントタブの cwd は、実態と違う値になりうる

### 症状

`useTmux` が有効なエージェントタブでは、PTY プロセスは `tmux new-session ...`（tmux クライアント）であり、
`lsof` が返すのはそのクライアントの cwd。**tmux の中で動いている `claude` が実際に居るディレクトリとは無関係**。

### 原因

cwd の観測対象が「PTY として spawn したプロセス」であること。tmux はサーバ・クライアント型なので、
実際の作業プロセスは別プロセスツリーに居る。

### 影響範囲

- 現状は**実害なし**。追跡のポーリング対象を `kind === 'shell'` に限定しているため、この値は読まれない
- エージェントタブの cwd を画面に出す提案（#20 の PR 8 / PR 10）が入ると、表示する値の出どころとして再検討が要る

### 対処方針

- [ ] #20 の PR 8 / PR 10 に着手するとき、エージェントタブの cwd は「spawn したときの値」を使うと決めて明文化する（追跡はしない）

### 優先度

P3

### ステータス

未対処（記録のみ。仕様として妥当なので、忘れないための記録）

---

## 2. 「ポーリング対象はアクティブなタブ1枚」という前提は、分割表示（#56）で崩れる

### 症状

追従のポーリングは、アクティブな**タブ**1枚のシェルにだけ問い合わせている。
分割表示が入ると「1タブに複数ペイン」になり、**どのペインの cwd をサイドバーに映すのか**が未定義になる。

### 原因

`useTabs.ts` の実装が「アクティブなタブ = 見ているシェルは1つ」を前提にしている。
#56 の known-issues 2（「1タブ = 1エージェント」の前提が崩れる箇所が未定義）と同じ根。

### 影響範囲

- `src/renderer/src/tabs/useTabs.ts` の追従ポーリング
- サイドバーのスコープ表示（#20 の PR 13）

### 対処方針

- [ ] #56 の実装で「アクティブなペイン」の概念が入ったら、ポーリング対象をそちらへ移す
- [ ] ペイン数に比例して `lsof` の起動が増えないこと（対象は常に1つ）を維持する

### 優先度

P2

### ステータス

未対処（#56 側で扱う。ここは前提の記録）

---

## 3. 他セッションの git worktree を eslint が拾い、`make check` の lint が落ちる

### 症状

`.claude/worktrees/<別ブランチ>/` が存在する状態で `npm run lint` を回すと、
そのワークツリー配下のファイルについて 226 件の
`Parsing error: No tsconfigRootDir was set, and multiple candidate TSConfigRootDirs are present` が出る。
**変更内容とは無関係に落ちる**（今回、別セッションが作業中の worktree が作られた時点で落ち始めた）。

### 原因

`eslint.config.js` の `ignores` に `.claude/worktrees/**` が無く、
typescript-eslint の tsconfig 自動探索が複数のチェックアウトを候補として見つけてしまう。

### 影響範囲

- `make check` の lint（このリポジトリの唯一の関門コマンド）が、worktree のある間つねに赤になる
- 既存の `ignores` には `e2e/report/**` について「除外しないと make e2e の後に make check が数千件のエラーで落ちる」という**同型の前例**がある

### 対処方針

- [ ] `eslint.config.js` の `ignores` に `.claude/worktrees/**` を足す（`e2e/report/**` と同じ理由・同じ書き方）
- 回避策: `npx eslint . --ignore-pattern '.claude/worktrees/**'`（これは clean に通る）

### 優先度

P2

### ステータス

未対処。**Issue #58 とは無関係の環境側の問題なので、この PR には混ぜていない**（1行の修正だが、cwd 追跡の PR に紛れると差し戻しの単位が濁る）

---
