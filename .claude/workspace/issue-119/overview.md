# Issue #119 P1: UI/UX デザイン刷新の完遂 - Overview

> **Issue**: [#119 P1: UI/UX デザイン刷新の完遂（#20 の残り全部）](https://github.com/i-iwnl/ai-terminal/issues/119)
>
> #20（クローズ済み）が定めたデザイン刷新のうち、残っている PR 13(残) / 16 / 18 / 20 と Phase 1 の積み残しを畳んだ Issue。
> **設計判断の根拠・却下した案とその理由・実測値の表は #20 の本文が引き続き正。**
> 2026-08-03 の5ペルソナレビューで案の前提が5つ壊れており、その裁定は `architecture.md` が正。
>
> 詳細は以下の3ドキュメントに分割:
>
> - `architecture.md` - 触る構造・Contract 変更・設計判断（レビューの裁定を含む）
> - `worklog.md` - 時系列の作業ログ・次に再開するとき最初に読むべきこと
> - `known-issues.md` - 判明した問題・未解決事項・先送りしたもの
>
> **最終更新**: 2026-08-03

---

## 1. ゴール

#20 のデザイン刷新を完遂させる。**ただし5ペルソナレビューで案の前提が5つ壊れたため、実装の前に「壊れたときに赤くなる検査」を置く周（周1）を先頭に足してある。**

現在の 70 spec は、この周が変えようとしている **A-1 の当たり判定 / F-1 の帯の高さ / G の選択中タブの線 / selectionBackground のいずれも1本も見ていない**。最後に `make e2e` を回しても緑のまま通る。

| カテゴリ | 対象 |
|---|---|
| 対象トラック | main（BrowserWindow・config）+ renderer（React UI）の2トラック |
| ブランチ | 未作成 |
| 関連 PR | 未作成 |

---

## 2. 完成条件

観測できる形で書く。「実装する」ではなく「何が観測できたら終わりか」。

### 周1: 関門を先に置く（値も見た目も1つも変えない）— **完了 2026-08-03**

- [x] `--bar-height` トークンを作り、`.tab-bar { height }` と `.notice-list { top: calc(36px + ...) }` の 36 のリテラル複製を置換した。**`make css-substitution-check` PASS**
- [x] `.sidebar__drag-region`(40) と `.tab-bar`(36) の高さ、および段差 4px を固定する S73 が green。`--bar-height` を実行時に書き換えて描画が追従することも見る
- [x] 「履歴行のタイトルは右端まで resume に届く」を `document.elementFromPoint()` で9点撃つ S74 が green。`.history-item__row` 139px / `.history-item__actions` 88px を characterization で固定
- [x] `selectionBackground` の関門を `test/unit/selection-contrast.test.ts` に置いた
- [x] サイドバーの見出し2種の宣言が一致していることを `test/unit/css-tokens.test.ts` で固定した（周3 で畳める前提）
- [x] **4つの関門すべてが、壊すと赤くなることを実測で確認した**（下記）
- [x] `e2e/scenarios.yml` を同じ周で更新し `make e2e-lint` FAIL=0（PASS=518）

**計画から外したもの:**

- **`.panel-heading` への畳み込みは周3 へ移した。** セレクタをまとめると `verify-css-substitution.mjs` は宣言の出現回数が減るので**必ず FAIL する**（あれは「トークンを展開したテキストが一致するか」を見るスクリプトで、構造のリファクタは表現できない）。周1 の受け入れ条件「`css-substitution-check` PASS」と両立しないため、構造を変える周3 に寄せた。代わりに**畳める前提（2つの宣言が本当に同一であること）を単体テストで固定した**
- **「選択中タブの線」を S40 / S41 に足すのはやめた。** S40 には既に `選択中タブの塗り（対タブバー）` が `wcag: 'fail'`（1.23）として記録されており、**それが既に characterization になっている**。線を足す周5 で、その隣に線の値を pass として足すのが正しい形
- **`selectionBackground` を S40 に足すのはやめた。** 選択範囲は xterm が canvas に描くので DOM に存在せず、`e2e/fixtures/contrast.ts` の `getComputedStyle` ベースの実装では**原理的に測れない**。`src/shared/theme.ts` の `contrastRatio()`（S40 と同じ式）を使う単体テストに置いた

**壊して赤くなることを確認した記録:**

| 壊し方 | 赤くなったもの |
|---|---|
| `.notice-list { top }` をリテラル `36px` に戻す | 単体（`--bar-height` を参照していない） |
| `selectionBackground` を `#3a6ea5`（塗り 3:1 達成）に上げる | 単体3件。**塗りを 3:1 にすると前景が 4.5:1 を割ることが実証された** |
| `.history-item__actions` を `position: absolute` にし、`pointer-events` を省く | **S74。タイトル上の9点中5点が resume に届かなくなる** |
| `--bar-height` を 40px に変える | S73 |
| `.history-list__heading` の `color` を1つ変える | 単体（見出し2種の宣言の一致） |

### 周2: A（履歴行の幅回復）— **完了 2026-08-03**

- [ ] `.history-item__action` に `pointer-events: none`、hover / focus で `auto` を入れた。**周1 の elementFromPoint assert が green になった**
- [ ] `.history-item__actions` をフローから外し、`.history-item__row` の実効幅が 235px 近くまで回復した（`getBoundingClientRect()` で実測）
- [ ] `.history-item__meta` に `min-width: 0` + `text-overflow: ellipsis` を入れた
- [ ] **「見た目を変えない」と名乗っていない。** `.history-item__title` の省略位置が動くので S16 / S18 / S19 を撮り直した

### 周3: B（スコープ行）+ C（改名しない結論）— **完了 2026-08-03**

- [ ] 本体ウィンドウに `<h1>`（視覚的非表示）が1つあり、既存の `<h2>` の階層が整理された
- [ ] タスク / メモの最上部にスコープ行が常設され、**0 件のときも消えない**
- [ ] 履歴の `history-list__heading` と `history-list__scope-note` が同じことを2回言っていない
- [ ] 履歴行の meta に、`allFolders` のときフォルダ名が出る（周2 の ellipsis があるので折り返さない）
- [ ] C の結論（改名しない）と、**#115 で出荷済みの設定の節名「動作中の AI」との整合**をこの Issue に書き戻した
- [ ] スコープ行の文字列を固定する spec が green（S70 / S71 と同じ characterization の形）

### 周4: D（サイドバー幅）— **完了 2026-08-03**

- [ ] `clampSidebarWidth()` が `test/unit/` にあり、**下限が信号機の実測右端（x=76）より上**であることを固定している
- [ ] ハンドルは `PaneSplitterHandle.tsx` と同じゴースト方式で、**ドラッグ中に `pty.resize` が0回**であることを実測した
- [ ] 幅は `--sidebar-width` カスタムプロパティ経由。**`Opt+Cmd+S` で畳めることを S72 が引き続き green で示している**
- [ ] 「表示」メニューに `サイドバーを広げる` / `狭める` / `既定の幅に戻す` の3項目があり、`accelerator` を持たない
- [ ] `AppConfig.sidebarWidth` が永続化され、`configSet` は `mouseup` で1回だけ呼ばれる
- [ ] `DEFAULT_CONFIG.sidebarWidth` を `src/shared/defaults.ts` に足した（E2E ハーネスが読む）

### 周5: F（ウィンドウ）+ G（選択中タブ）+ state slot

- [ ] **vibrancy が実機で見えているかを確認し、結果を記録した**（`body` が不透明なので一度も見えていない疑いがある）
- [ ] `.sidebar__drag-region` と `.tab-bar` の高さが揃い、`trafficLightPosition` が光学中心と一致した（周1 の characterization spec の diff がレビュー資料）
- [ ] フルスクリーンでドラッグ帯が畳まれ、復帰時に `trafficLightPosition` が再適用される
- [ ] ウィンドウの位置・サイズ・フルスクリーンが復元される。**`config.json` ではなく `window-state.json`**（`memo/store.ts` / `history/titles.ts` と同じ形）
- [ ] `win.setTitle()` がアクティブタブに同期する
- [ ] `.tab-bar__tab.is-active` に白 2px の `box-shadow: inset 0 -2px 0`。**S40 の `選択中タブの塗り（対タブバー）` 1.23 の隣に、線の値が pass として記録された**
- [ ] `.tab-bar__state-slot` に「あなたの番」のドット（丸）が配線され、`tabAccessibleLabel` に語が入った
- [ ] `docs/images/` 12枚を撮り直した。**1枚ずつ「この画面にこの変更が波及するはずがあるか」を言えた**

### 周6: E（テーマ切替 UI）

- [ ] `src/shared/themes.ts` に `THEME_PRESETS` があり、**`chromeSafeToApply === true` を単体テストが関門にしている**（Nord / Dracula / One Dark / Gruvbox Dark は全滅するので候補から外れる）
- [ ] `AppConfig.themeName` を足し、`themeName: 'custom'` の番人値を最初から型に入れた
- [ ] **`S21-config.spec.ts` が無傷**（`themeName` 未設定なら保存済み `theme` が勝つ設計）
- [ ] `App.tsx` の `chromeSafeToApply === false` で `removeProperty` を呼ぶ else 節がある（**現状は前回のインライン値が残り続けるバグ**）
- [ ] 設定の「外観」節にテーマ選択があり、`S70-settings-labels-contract.spec.ts` の記録を更新した
- [ ] `chromeSafeToApply === false` のとき、その旨が画面と `announce()` に出る

### 全周共通

- [ ] `make check` が通る
- [ ] **`make e2e` は P1 の最後に1回**。ただし `make e2e-lint` は毎周、`make e2e-screenshots` はセレクタを変えた周ごとに回す
- [ ] `README.md` を更新した（サイドバー幅のメニュー・テーマ切替・タブの状態ドット）
- [ ] 耐久性のある規約を `.claude/skills/design-review/reference/design-rules.md` に反映した

---

## 3. 現状進捗

| 項目 | 状態 |
|---|---|
| 設計 | **完了**（5ペルソナレビュー実施済み。裁定は `architecture.md`） |
| 実装 | **進行中**（周1〜4 完了 / 周5・6 が残り） |
| 検証 | 各周で `make check` + 名指しの spec + agent-browser。**`make e2e` は P1 の最後に1回** |

---

## 4. 直近の次アクション

| 優先度 | アクション | 詳細 |
|---|---|---|
| **P0** | 周5（F: ウィンドウ + G: 選択中タブ + state slot） | **先頭で vibrancy の生死を実機確認する**（known-issues の 3）。画像12枚の撮り直しはここ1回にまとめる |
| P1 | 周6（E: テーマ切替 UI） | `chromeSafeToApply === false` の `removeProperty` 漏れ（known-issues の 2）を同じ周で直す |
