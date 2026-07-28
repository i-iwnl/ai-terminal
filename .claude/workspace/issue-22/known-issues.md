# Known Issues

実装中に発見された未解決のバグ・先送りした課題。
詳細な観察記録は `worklog.md` を参照。

---

## 1. メニューとキーボードの二重発火が、自動テストでは検出できない

### 症状

メニュー項目の accelerator を `registerAccelerator: true`（既定）にしてしまうと、
Main とRenderer の両方が同じキーを拾い、**`Cmd+T` 一回でタブが2枚開く**。
この退行を `make e2e` は検出できない。

### 原因（判明している場合）

- Playwright の `keyboard.press()` は Renderer に合成キーイベントを送るだけで、ネイティブメニューの accelerator 経路を通らない
- `MenuItem` インスタンスから `registerAccelerator` を読めない（実測で全項目 `undefined`。`item.accelerator && item.click` で拾った46項目すべてが「登録済み」と判定された）

つまり **構造上、この性質は E2E の守備範囲外**。

### 影響範囲

- `src/main/menu.ts` の `actionItem()`
- 将来メニュー項目を増やすとき、`registerAccelerator: false` を書き忘れると同じ退行が起きる

### 対処方針

- [ ] **実機で確認する**: `make dev` で起動し、`Cmd+T` を1回押してタブが1枚だけ増えることを見る。あわせて `Cmd+Shift+C` で claude が1本だけ起動すること、`Cmd+R` で画面が消えないことも見る
- [ ] `actionItem()` を経由しないメニュー項目を追加しないこと（`registerAccelerator: false` はこのヘルパにだけ書いてある）

### 優先度

P2

### ステータス

未対処（自動化できないため `manual-only` 相当）

---

## 2. 開発起動と本番起動でメニューの中身が違う

### 症状

`isDev()`（`ELECTRON_RENDERER_URL` の有無）で「表示」メニューに再読み込みと DevTools を出し分けている。
**開発中に見ているメニューは、ユーザーが見るメニューと同じではない。**

### 原因（判明している場合）

意図的な分岐だが、開発中に「Cmd+R が効く」ことを確認しても本番の担保にならない。
E2E はビルド済みアプリを起動するので本番側を通っている（S36 が守っているのはこちら）。

### 影響範囲

- `src/main/menu.ts` の `buildTemplate()`

### 対処方針

- [ ] 手動確認は `make build` した成果物に対して行う。`make dev` での確認は本番の担保にならないことを忘れない

### 優先度

P3

### ステータス

未対処（仕様。忘れないための記録）

---

## 3. `Cmd+Opt+*` が構造的に登録できない

### 症状

`src/renderer/src/lib/shortcuts.ts` の `if (!e.metaKey || e.ctrlKey || e.altKey) return null;` により、
`Cmd+Opt` 系のキーを1つも登録できない。使える名前空間は `Cmd+key` と `Cmd+Shift+key` だけ。

### 原因（判明している場合）

「Ctrl+C など端末本来の入力を絶対に妨げない」という正しい意図の実装だが、`Cmd` が押されている時点で
端末入力とは衝突しないため、`alt` まで弾く必要はない。

### 影響範囲

- 今回 `Cmd+Shift+C` / `Cmd+Shift+G` を新設したことで、`Cmd+Shift` 系の空きが減った
- 親 Issue [#20](https://github.com/i-iwnl/ai-terminal/issues/20) の J（キーボード）が提案している
  `Opt+Cmd+S`（サイドバー開閉）などが**現状の実装では登録できない**

### 対処方針

- [ ] #20 の J に着手するとき、`Cmd+Opt` を解禁する（`altKey` の除外をやめる）
- [ ] 解禁したら `test/unit/renderer-lib.test.ts` の「Cmd と Ctrl / Alt の同時押しは対象外にする」を分割する（Ctrl は弾き続ける）

### 優先度

P2

### ステータス

未対処（#20 の J で扱う）

---
