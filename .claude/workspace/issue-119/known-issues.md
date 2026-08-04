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
| 1. `.history-item__action` に `pointer-events: none` が無い | **解決済み** | `715f4e0`。ただし修正が入ったのは `.history-item__action`（単数）ではなく **`.history-item__actions`（複数・入れ物）**。`:hover` / `:focus-within` で `auto` に戻す構造。`e2e/specs/S74-history-row-hit-area.spec.ts` が `elementFromPoint()` で9点を撃って固定 |
| 2. `chromeSafeToApply === false` が前回のインライン値を消していない | **解決済み** | `715f4e0`。`App.tsx` に `SURFACE_VARS`（4本）を宣言し、`if (!chromeSafeToApply) { for (const name of SURFACE_VARS) root.removeProperty(name); return; }`。`S80` の「既定へ戻せる」節が assert |
| 3. vibrancy が一度も見えていない疑い | **調査完了・コメント訂正済み** | `715f4e0`。事実（見えていない）は真だが、`src/main/index.ts` と `styles.css` の両コメントが実測結果（不透明な層が2枚。`transparent: true` か `backgroundColor: '#00000000'` が要る）に書き換わり、食い違いは解消。**透明化そのものは意図的な非目標**として宣言済み |
| 4. サイドバー上端の見出しの正が4箇所に散りうる | **解決済み（畳まず分離）** | `715f4e0`。`.history-list__heading` は CSS から消え、`.panel-scope` / `.task-group__heading` / `.memo-panel__heading` の3種に整理。`test/unit/css-tokens.test.ts` の4件が「互いに別物であること」を固定 |
| 5. `.notice-list` が 36px をリテラル複製している | **解決済み** | `715f4e0`。`:root` に `--bar-height: 36px`、参照は `.sidebar__drag-region` / `.tab-bar` / `.notice-list` の3箇所。`src/shared/windowChrome.ts` の `BAR_HEIGHT_PX` との一致を含め `test/unit/css-tokens.test.ts` の5件が固定。`S73` が実行時にも追従を見る |
| 6. `docs/images/` が古くなっても検出されない | **解決済み** | `d7a4db1`。`scripts/verify-screenshots.mjs`（`make e2e-screenshots-check`）の check3 が撮り立てとコミット済みを画素比較する |
| 7. S40 に未較正の期待値が4件残っている | **解決済み** | `8d5e77f`（#120 周6）。4件とも実走で較正され、**小数第2位まで手計算値と一致**。spec のコメントが「較正のために意図的に落とす必要は無い」「`console.log` は成否に関わらず毎回実測値を出す」と明記 |
| 8. 撮影レーンの非決定性3種類 | **解決済み** | `5910aca`（経過時間の固定化 / 空状態を待つ `waitForTaskList()`）+ `d7a4db1`（偽 claude が UUID を `<session-id>` へ置換して発生源で断つ）。`KNOWN_NONDETERMINISTIC` に残るのは S56 の1枚だけで、理由は zsh の部分行マーカー `%`（別種） |

**記述のずれ**: 7 番の「`e2e/scenarios.yml` と S40 に」— scenarios.yml の S40 エントリに数値は**最初から1件も無い**（note は方針文のみ）。同じく 7 番の「落ちて初めて実測値がログに出る仕組み」も誤りで、S40 の spec コメントがこの known-issues.md を名指しで訂正している。

**6 / 7 / 8 のステータス欄は「未対処」「別 Issue へ委譲」のままだが、実コードでは解決済み。**

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

- [x] 周1 で `document.elementFromPoint()` の assert を置き、**絶対配置にすると
      9点中5点が resume に届かなくなる**ことを実測で確認した（S74）
- [x] 周2 で `pointer-events: none` を入れ物側に入れた

> **症状の記述を訂正する。** 「`::before` が meta の行に上下 3.5px ずつはみ出している」は
> **成立していなかった**。ボタンの実寸は 14px ではなく 21px で、`::before` の下端 200.5 に
> 対し meta の上端は 201.5（1px の余裕がある）。**本当の危険は絶対配置にした瞬間に
> タイトルの上へ浮くこと**で、そちらは実測で再現・修正済み。

### 優先度

P1（A-1 の前提）

### ステータス

**対処済み**（周2）

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

- [x] `removeProperty` を4本呼ぶ else 節を足した（周6）
- [x] `S80-theme-preset.spec.ts` が「既定へ戻したときにインライン値が残らない」を固定した

### 優先度

P1（E の前提）

### ステータス

**対処済み**（周6）

---

## 3. vibrancy が一度も見えていない疑い

### 症状

`src/main/index.ts` は `vibrancy: 'sidebar'` を指定し、コメントは
「vibrancy が実際に見えるのは `.sidebar__drag-region`（40px）だけ」と書いている。
だが `styles.css` の `body { background: var(--surface-1) }` は不透明で、
`html` に背景が無いため body の背景がキャンバスへ伝播する。
加えて `createWindow()` は `backgroundColor: SURFACE.base` を**明示している**
（`transparent: true` は無い）。**不透明な層が2枚重なっている。**

### 原因（**2026-08-03 の周5 で確定**）

実機の `getComputedStyle` で測った結果、**不透明な層が2枚あった。**

| 層 | 実測 |
|---|---|
| `BrowserWindow` の `backgroundColor` | `#1e1e1e`（`src/main/index.ts` が明示） |
| `body` の背景 | `rgb(30, 30, 30)`（`html` に背景が無いのでキャンバスへ伝播する） |

`.sidebar` / `.sidebar__drag-region` は透明（`rgba(0,0,0,0)`）だが、その下に
この2枚がある。Electron で vibrancy を見せるには `transparent: true` か
`backgroundColor: '#00000000'` が要る。**vibrancy は一度も見えていない。**

### 影響範囲

- `src/main/index.ts` の `createWindow()` のコメント（事実と食い違っている可能性）
- `styles.css` の `@media (prefers-reduced-transparency: reduce)`（**透けていないなら死にコード**）
- **F-1（帯の高さ）の判断材料。** 「高さを変えると vibrancy の面積が変わる」という制約が
  そもそも存在しない可能性がある
- `docs/images/*.png` は撮影経路で左上が `--surface-1` に落ちるため、
  **vibrancy が生きているなら実機の見た目と違う**

### 対処方針

- [x] 周5 で実機確認した（agent-browser）
- [x] `styles.css` と `src/main/index.ts` の**事実と食い違っていたコメントを訂正した**
- [x] **透明化には踏み込まない判断をした。** 透明化は
      「ライブリサイズ中に macOS が塗る色」（`backgroundColor` のコメント）と
      `S40-contrast-contract.spec.ts` の前提（サイドバーの文字コントラストが
      デスクトップの壁紙に依存しない）の両方に影響する。**見た目のために
      測定済みの保証を崩す取引**になるので、やるなら独立した周で
- [x] `vibrancy: 'sidebar'` の指定と `prefers-reduced-transparency` の規則は**残した**
      （消すと「検討した結果やらない」のか「知らなかった」のかが分からなくなる。
      透明化する周が来たときにフォールバックが無い状態から始めないため）

### 優先度

P2（F-1 の判断材料としては決着済み。透明化そのものは別の周）

### ステータス

**調査完了・対処済み**（透明化は意図的に非目標）

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

- [x] **畳まずに別物にした**（周3）。履歴の見出しは「範囲」、タスクのグループ見出しは
      「区切り」で、同じ体裁にすると3つ並んだときに1つ目だけ意味が違う状態になる。
      `.panel-scope`（下線あり・大文字化なし）と `.task-group__heading`（下線なし・
      大文字化あり）に分け、**両者が同一ではないこと**を `test/unit/css-tokens.test.ts` が固定
- [x] `.memo-panel__heading` は別物のまま残した（同テストが固定）

### 優先度

P2

### ステータス

**対処済み**（周3。畳むのではなく分けた）

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

- [x] 周1 で `--bar-height` トークンに置換した（値は変えず、`css-substitution-check` PASS）
- [x] 周5 で `.sidebar__drag-region` も同じトークンを参照させ、**段差を 4px から 0 にした**

### 優先度

P2

### ステータス

**対処済み**（周1 で置換、周5 で値を揃えた）

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

- [ ] **未対処のまま残した。** 周5 で S40 を回したが、4件は**期待値どおりに通った**ので
      較正の必要が生じなかった（落ちて初めて実測値がログに出る仕組みのため、
      通っているうちは手計算値と実測値の一致/不一致が分からない）。
      **`.tab-bar__tab--*` の色を次に触る周で、意図的に落として実測値へ置き換えること**

### 優先度

P2

### ステータス

未対処（#120 へ引き継ぐ）

---

## 8. `make e2e-screenshots` は毎回違う画像を生成する（非決定性が3種類ある）

### 症状

周2 で撮り直したあと、`docs/images/` の13枚のうち **11枚に画素差が出た**。
追跡した結果、**そのうち8枚は今回の変更とは無関係**で、撮影レーンの非決定性だった。

| 非決定性 | 実例 | 影響する画像 |
|---|---|---|
| **タスク一覧の経過時間** | `109時間9分` -> `172時間52分`。偽 CLI の `agents.json` は `startedAt` が固定なので、**撮るたびに増え続ける** | S01 / S03 / S04 / S06 / S12 / S22 / S09 / S56 |
| **セッション UUID がランダム** | `--session-id 8f394c96-...` -> `640a566e-...`。ターミナルに `ARGS:` として出る | S09 / S56 |
| **空状態が写ることがある** | S01 の再撮影で、タスク一覧ではなく「動いている AI はまだありません / Claude を起動」が写った。ポーリングが間に合わなかったと思われる | 全部 |

### 影響範囲

- **#121（P3）の B-2 が挙げている案2「`make e2e-screenshots` を回して、
  生成された画像がコミット済みのものと差分ゼロであることを検査する」は、
  この非決定性がある限り成立しない。** しきい値付きの画像比較でも、
  経過時間の桁が変われば文字幅が変わるので吸収できない
- **#120（P2）の D-2（動的フィクスチャ）と根が同じ。** 固定 `agents.json` の
  `startedAt` を「撮影時刻からの相対」にすれば、経過時間の非決定性は消せる
- 撮り直しのたびに「この画面にこの変更が波及するはずがあるか」を人が1枚ずつ
  判定しないと、**無関係な差分が混ざったままコミットされる**

### 対処方針

- [ ] **この Issue では対処しない。** #120 の D-2 と #121 の B-2 の担当
- [ ] この Issue の各周では、**RGB で画素差を測り、説明できない差分の画像は
      `git checkout HEAD --` で戻す**という運用で守る（周2 で実施）
- [ ] 経過時間の非決定性は、偽 CLI の `startedAt` を撮影時刻からの相対にすれば
      消せる見込み。#120 の D-2 で動的フィクスチャを入れるときに一緒に直す

### 優先度

P2

### ステータス

未対処（#120 / #121 へ委譲。この Issue では運用で回避）
