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
| 1. 設定ウィンドウにメニューの操作が効かない | **生きている → #152** | `actionItem()` は今も `win` を閉包で掴んで無条件に送る。`grep -rn "getFocusedWindow" src/` は 0件。`actionItem(win, ...)` の呼び出しは37箇所。**キーボード経路は無害**（`registerAccelerator: false` により、Esc / `Cmd+W` は `SettingsPanel.tsx` の window keydown が捌く）。再現するのはマウスでメニューをクリックした場合だけ。ただし「実害は小さい」という当時の評価より重い — `close-pane` / `close-tab` など**破壊的なアクションが増えた** |
| 2. 設定ウィンドウの位置・サイズが保存されない | **生きている → #153** | `openSettingsWindow()` は今もリテラル固定。**ただし「#20 の K-9 で一緒に扱う」は外れた** — K-9 は `715f4e0` で `src/main/window-state.ts` として本体ウィンドウ専用に着地し、設定ウィンドウは対象外のまま。`settings-window.ts` は `window-state` を import すらしていない。**待つ理由は消えており、いま着手できる** |
| 3. `FALLBACK_CONFIG` と `DEFAULT_CONFIG` の二重化 | **解決済み** | `26128bb`。`src/renderer/src/lib/defaults.ts` は削除済み、`FALLBACK_CONFIG` という識別子は定義が存在しない（`App.tsx` にもう存在しない名前を指すコメントが1行残るのみ）。`DEFAULT_CONFIG` の定義は `src/shared/defaults.ts` の1箇所だけ。※「#20 の PR 1 で扱う」ではなく `26128bb` で直った |

**記述のずれ**: 2 番の「毎回既定の位置とサイズで出る」— **横幅は仕様として固定**（`minWidth === maxWidth === 520`）。保存対象は x / y / height の3つ。

---


## 1. 設定ウィンドウにメニューの操作が効かない

> **GitHub Issue**: [#152](https://github.com/i-iwnl/ai-terminal/issues/152)

### 症状

設定ウィンドウにフォーカスがある状態でメニューバーの項目を選ぶと、操作は
**本体ウィンドウ**に対して実行される（新しいタブが本体に開く、など）。

### 原因（判明している場合）

`src/main/menu.ts` の `actionItem()` が、メニュー生成時に掴んだ本体ウィンドウへ
`webContents.send` する実装になっている。フォーカス中のウィンドウを見ていない。

### 影響範囲

- `src/main/menu.ts`

### 対処方針

- [ ] `BrowserWindow.getFocusedWindow()` を見て、本体でなければ何もしない（または本体へ送る前に本体を前に出す）
- [ ] 実害は小さい（設定ウィンドウを見ている間にタブを増やす操作は稀）ため、メニューを増やすときにまとめて直す

### 優先度

P3

### ステータス

未対処

---

## 2. 設定ウィンドウの位置・サイズが保存されない

> **GitHub Issue**: [#153](https://github.com/i-iwnl/ai-terminal/issues/153)

### 症状

閉じて開き直すと、毎回既定の位置とサイズで出る。

### 原因（判明している場合）

`openSettingsWindow()` が固定値で生成している。

### 影響範囲

- `src/main/settings-window.ts`

### 対処方針

- [ ] #20 の K-9（ウィンドウ状態の復元）で本体ウィンドウと一緒に扱う。**設定だけ先に入れると、保存先の設計が二度手間になる**

### 優先度

P3

### ステータス

未対処（#20 の K-9 で扱う）

---

## 3. `FALLBACK_CONFIG` と `DEFAULT_CONFIG` の二重化が残っている

### 症状

`src/renderer/src/lib/defaults.ts` と `src/main/config.ts` に同じ既定値が手で書かれている。
片方に項目を足し忘れると、設定の取得に失敗したときだけ挙動が変わる。

### 原因（判明している場合）

Renderer から Main のモジュールを import できないため。

### 影響範囲

- `src/renderer/src/lib/defaults.ts`
- `src/main/config.ts`

### 対処方針

- [ ] `src/shared/defaults.ts` へ寄せて単一の正にする。**#20 の PR 1 のスコープ**なので、この Issue では触らない

### 優先度

P2

### ステータス

未対処（#20 の PR 1 で扱う）

---
