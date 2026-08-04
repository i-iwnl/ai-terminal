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
| 1. 通知のクリックは自動テストできない | **一部が生きている → #151** | **対処方針の2つ目（Renderer 側の受け口を `webContents.send` で担保）は `4a7556d` で実施済み**。`e2e/specs/S63-task-pane-focus.spec.ts` の `sendSessionFocus()` が3ケースを検証する。残っているのは**実機確認1件だけ**なので、#151 はそこに絞って起票した |
| 2. 対応するタブが無ければ何も起きない | **解決済み** | `4a7556d`（#120 C-2）。`App.tsx` の `session.onFocus` が `findPaneByAgentSessionId` で見つからないとき `showNotice('このセッションを開いているタブはありません（サイドバーの「タスク」で確認できます）', 'info')` と `announce()` を呼ぶ。`S63` が未知 UUID で検証済み。※ 対処方針にあった「サイドバーの行を強調する」という着地ではない（通知バナー + アナウンス）。`--resume` の自動起動は却下のまま |
| 3. Dock バッジは macOS / Linux のみ | **生きている。起票しない** | ステータスが「対処しない（記録のみ）」で、その前提（macOS 専用）が `README.md` と `electron-builder.yml`（`mac:` のみ）で維持されていることを確認した。Windows 対応を始めるときに初めて意味を持つ記録 |

---


## 1. 通知のクリックは自動テストできない

> **GitHub Issue**: [#151](https://github.com/i-iwnl/ai-terminal/issues/151)

### 症状

`notification.on('click')` を登録したが、OS の通知センターをクリックする操作を
Playwright から起こす手段が無い。**この Issue の中心的な価値が自動では守られていない。**

### 原因（判明している場合）

OS 通知はアプリの外にあり、Electron / Playwright のどちらからも操作できない。

### 影響範囲

- `src/main/notify/index.ts` の `onClick` 配線
- `src/main/agents/poller.ts` の `focusSession()`
- `src/renderer/src/App.tsx` の `session.onFocus` 購読

### 対処方針

- [ ] **実機で確認する**: `make build` した成果物で claude を起動し、作業が終わったときの通知をクリックして、ウィンドウが前に出て該当タブがアクティブになることを見る
- [ ] Renderer 側の受け口（`session.onFocus`）だけなら、`webContents.send` を Main から直接呼べば E2E で担保できる。**やる価値はあるが、今回は入れていない**（Main -> Renderer の半分だけを緑にすると、通知側が壊れていても気づけない偽の安心になりうる）

### 優先度

P2

### ステータス

未対処（`manual-only` 相当）

---

## 2. 通知をクリックしても、対応するタブが無ければ何も起きない

### 症状

他のターミナルで起動した claude（`ownedByApp` でないセッション）は、このアプリにタブが無い。
通知をクリックするとウィンドウは前に出るが、**それ以上は何も起きない。**

### 原因（判明している場合）

意図的にそうしている。通知のクリックで `--resume` を使って新しいプロセスを起動するのは
副作用が大きく、意図しない起動につながる。

### 影響範囲

- `src/renderer/src/App.tsx` の `session.onFocus` 購読

### 対処方針

- [ ] サイドバーの該当行までスクロールして強調する、程度の穏当な着地を検討する
- [ ] #20 の B（他ターミナル起動分の行を `--resume` で開けるようにする）と合わせて設計する。**そちらが入れば、通知クリックからも同じ導線を使える**

### 優先度

P3

### ステータス

未対処（先送り）

---

## 3. Dock バッジは macOS / Linux のみ

### 症状

`app.setBadgeCount` は Windows では機能しない。存在チェックで落ちないようにはしているが、
Windows では「あなたの番」の件数を伝える手段が無い。

### 原因（判明している場合）

プラットフォームの差。現状このアプリは macOS 専用なので実害は無い。

### 影響範囲

- `src/main/agents/poller.ts` の `updateDockBadge()`

### 対処方針

- [ ] macOS 専用の前提を崩さない限り対処しない（#20 の非目標にも「クロームの汎用化はしない」と明記済み）

### 優先度

P3

### ステータス

対処しない（記録のみ）

---
