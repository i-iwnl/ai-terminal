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
| 1. メニューとキーボードの二重発火を検出できない | **生きている → #144** | `actionItem()` の `registerAccelerator: false` はここ1箇所のまま。`accelerator` を持つのに `actionItem()` を通らない項目は「設定...」（`Cmd+,`）の1件のみで、これは自前で `false` を書いている正当な例外。**部分的な進展**: S36 が `roles` を小文字正規化して `zoomin` / `zoomout` / `resetzoom` などの不在を検査するようになり、`role` 経由の亜種だけは固定された。一般則は誰も見ていない |
| 2. 開発起動と本番起動でメニューの中身が違う | **生きている → #145** | `isDev()` の分岐は現存。S36 が本番側を守っているのも記述どおり。ただし**この注意がリポジトリ内のどこにも書かれていない**（`limitations.md` にメニューの記述なし）ことが実質的な課題 |
| 3. `Cmd+Opt+*` が構造的に登録できない | **解決済み** | `6fa849a`（`altKey` ガードを矢印限定で緩める）→ `bbd1d76`（全面解禁）。`shortcuts.ts` の現在のガードは `passesModifierGate()` の `if (!e.metaKey || e.ctrlKey) return false;` で `|| e.altKey` は消えている。`Cmd+Option+S`（サイドバー = この項目が名指しした割り当てそのもの）/ `+W` / `+矢印` / `+数字` が実在。対処方針2つ目の単体テスト分割も `test/unit/renderer-lib.test.ts` で完了 |

**記述のずれ**（1 番の手動確認手順）: `Cmd+Shift+G` は現在「前を検索」で、Gemini タブは `Cmd+Shift+E`。`Cmd+R` は本番メニューに存在しない。手順をそのまま実行すると誤った期待になる。

---


## 1. メニューとキーボードの二重発火が、自動テストでは検出できない

> **GitHub Issue**: [#144](https://github.com/i-iwnl/ai-terminal/issues/144)

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

> **GitHub Issue**: [#145](https://github.com/i-iwnl/ai-terminal/issues/145)

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
