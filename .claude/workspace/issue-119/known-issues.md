# Known Issues

実装中に発見された未解決のバグ・先送りした課題。
詳細な観察記録は `worklog.md` を参照。

---

## 1. `.history-item__action` に `pointer-events: none` が無い

### 症状

`opacity: 0` で隠れているボタンの当たり判定が生きている。`::before` が
`width/height: max(100%, var(--target-size-min))` で 24px の高さを持つため、
**非表示のボタンの当たり判定が `.history-item__meta` の行に上下 3.5px ずつはみ出している。**

### 原因

`.tab-bar__close` は同じ問題を `pointer-events: none` で潰し、そのコメントに
「`opacity` だけで隠すと、非表示のあいだも 24x24 の当たり判定が反応してしまい、
常時表示していた頃と実害が変わらない」と明記している。
**同じ規則が `.history-item__action` には適用されていない。**

### 影響範囲

- `src/renderer/src/styles.css` の `.history-item__action` / `.history-item__action::before`
- **A-1（`.history-item__actions` の絶対配置）の前提。** 絶対配置にすると当たり判定が
  タイトルの上に浮き、タイトル右端のクリックが resume ではなく「編集」に当たる

### 対処方針

- [ ] 周1 で `document.elementFromPoint()` の assert を置き、**現状で赤くなることを確認する**
- [ ] 周2 で `pointer-events: none` + hover / focus で `auto` を入れる

### 優先度

P1（A-1 の前提）

### ステータス

未対処（この Issue の周2 で対処する）

---

## 2. `App.tsx` の `chromeSafeToApply === false` が、前回のインライン値を消していない

### 症状

```
if (!chromeSafeToApply) return;
root.setProperty('--surface-0', ...) // 以下4本
```

`return` するだけなので、**安全なテーマ A → 危険なテーマ B と切り替えると、
クロームは `:root` の静的値ではなく A の面を保持し続ける。**

### 原因

すぐ上のコメントは「`:root` の静的な値をそのまま生かす」と書いているが、
それは**一度もインライン適用が起きていない場合にしか成立しない**。

### 影響範囲

- `src/renderer/src/App.tsx` の `useEffect([config.theme])`
- **E（テーマ切替 UI）の前提。** プリセット選択はテーマ切替をワンクリックの日常操作に
  するので、この潜在バグが常態化する

### 対処方針

- [ ] `removeProperty` を4本呼ぶ else 節を足す（周6）

### 優先度

P1（E の前提）

### ステータス

未対処（この Issue の周6 で対処する）

---

## 3. vibrancy が一度も見えていない疑い

### 症状

`src/main/index.ts` は `vibrancy: 'sidebar'` を指定し、コメントは
「vibrancy が実際に見えるのは `.sidebar__drag-region`（40px）だけ」と書いている。
だが `styles.css` の `body { background: var(--surface-1) }` は不透明で、
`html` に背景が無いため body の背景がキャンバスへ伝播する。
加えて `createWindow()` は `backgroundColor: SURFACE.base` を**明示している**
（`transparent: true` は無い）。**不透明な層が2枚重なっている。**

### 原因（未確認）

未検証。**実機で DevTools から `document.body.style.background='transparent'` にして
左上が変わるか**を見れば1行で決着する。

### 影響範囲

- `src/main/index.ts` の `createWindow()` のコメント（事実と食い違っている可能性）
- `styles.css` の `@media (prefers-reduced-transparency: reduce)`（**透けていないなら死にコード**）
- **F-1（帯の高さ）の判断材料。** 「高さを変えると vibrancy の面積が変わる」という制約が
  そもそも存在しない可能性がある
- `docs/images/*.png` は撮影経路で左上が `--surface-1` に落ちるため、
  **vibrancy が生きているなら実機の見た目と違う**

### 対処方針

- [ ] 周5 の先頭で実機確認する（agent-browser + DevTools）
- [ ] 見えていないなら、`index.ts` のコメントを訂正し、`prefers-reduced-transparency` の
      規則を残すか消すかを決める
- [ ] 見えているなら、透明域は 40px ではなく約 98px（`.sidebar__tabs` の `margin: 8px` の
      額縁も透明）であることを確認する

### 優先度

P1（F-1 の前提）

### ステータス

調査中（この Issue の周5 で確認する）

---

## 4. サイドバー上端で「見出しの見た目」の正が4箇所に散りうる

### 症状

`.task-group__heading` と `.history-list__heading` は `styles.css` で
**宣言が完全に一致している**（`margin` / `padding` / `color` / `font-size` /
`font-weight` / `text-transform` / `letter-spacing` の7つとも）。

B（スコープ行）でタスクとメモに見出しを足すと、3個目・4個目になる。

### 影響範囲

- `src/renderer/src/styles.css`

### 対処方針

- [ ] 周1 で `.panel-heading` に畳む（**純粋な置換。`make css-substitution-check` PASS**）
- [ ] `.memo-panel__heading` は `color: var(--text-primary)` と `margin: 0 0 var(--sp-2)` で
      別物なので、畳むのは3個目まで

### 優先度

P2

### ステータス

未対処（この Issue の周1 で対処する）

---

## 5. `.notice-list` がタブバーの高さ 36px をリテラルで複製している

### 症状

`.notice-list { top: calc(36px + var(--sp-2)) }` と `.tab-bar { height: 36px }` が
**別々の 36** を持っている。

### 影響範囲

- F-1 で帯を 40 / 44 に上げると通知バナーがタブバーに被り、
  **キーボードでフォーカス中のタブが通知に完全に隠れる**（WCAG 2.4.11 Focus Not Obscured, AA）
- 今回は 36px に揃える判断なので実害は出ないが、複製は残る

### 対処方針

- [ ] 周1 で `--bar-height` トークンに置換する（**値は変えない**）

### 優先度

P2

### ステータス

未対処（この Issue の周1 で対処する）

---

## 6. `docs/images/` の中身が古くなっても機械で検出されない（既知・#121 の範囲）

### 症状

`scripts/lint-e2e.mjs` の check9 は「`screenshot` に書いた名前のファイルが
`docs/images/` に**存在するか**」だけを WARN で見る。

この Issue の周2 / 周3 / 周5 はすべてこの穴に落ちる。

### 対処方針

- [ ] **この Issue では対処しない。** #121（P3）の B-2 が担当
- [ ] この Issue では「1枚ずつ、この画面にこの変更が波及するはずがあるかを言えるまで
      コミットしない」という人間の規律で守る

### 優先度

P3

### ステータス

別 Issue（#121）へ委譲

---

## 7. `e2e/scenarios.yml` と S40 に、手計算のまま較正されていない期待値が4件残っている

### 症状

`シェルタブの色相の枠` 5.13 / `claude` 4.27 / `gemini` 4.82 / `終了マーク` 5.49。
**spec 自身が「次に S40 を実行する人は実測値へ置き換えること」と書いている。**

### 影響範囲

- `e2e/specs/S40-contrast-contract.spec.ts`

### 対処方針

- [ ] 周5（G）が `.tab-bar__tab.is-active` を触るので、**この周が S40 を回す最初の機会**になる。
      4件の較正を G の PR に同梱する（数値が動いたらそれ自体がレビュー資料）

### 優先度

P2

### ステータス

未対処（この Issue の周5 で対処する）
