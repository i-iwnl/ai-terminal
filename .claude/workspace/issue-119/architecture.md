# Architecture

Issue #119 における変更対象の構造。
**2026-08-03 の5ペルソナレビューで案の前提が5つ壊れた。その裁定が「4. 設計判断履歴」にある。着手前に必ず読むこと。**

---

## 1. 対象トラック

**main + renderer の2トラック。**

| コンポーネント | 変更内容 | 影響範囲 |
|---|---|---|
| `src/renderer/src/styles.css` | `.panel-heading` へ畳む / `--bar-height` トークン化 / `.history-item__*` / `.tab-bar__tab.is-active` / `.sidebar__drag-region` | 画像13枚のうち最大12枚。S40 / S41 / S44 / S72 |
| `src/renderer/src/sidebar/` | `TaskList` / `MemoPanel` にスコープ行、`HistoryList` の二重化解消と meta のフォルダ名 | S12 / S13 / S16 / S18 / S19 / S34 / S71 |
| `src/renderer/src/tabs/` | `Sidebar` のリサイズハンドル（新規）、`TabBar` の state slot 配線 | S72、新規 spec |
| `src/renderer/src/settings/SettingsPanel.tsx` | 「外観」節にテーマ選択 | **S70 が確実に落ちる**（記録の更新が作業の一部） |
| `src/renderer/src/App.tsx` | `chromeSafeToApply === false` の `removeProperty`、config の Sidebar への配線 | — |
| `src/main/index.ts` | `trafficLightPosition`、フルスクリーン購読、ウィンドウ状態の復元、`setTitle` | — |
| `src/main/window-state.ts`（新規） | ウィンドウの位置・サイズ・フルスクリーンの永続化 | **`config.json` には入れない**（理由は下記 D-6） |
| `src/shared/themes.ts`（新規） | `THEME_PRESETS` | `test/unit/` |
| `src/shared/ipc.ts` / `src/shared/defaults.ts` / `src/main/config.ts` | `sidebarWidth` / `themeName` | `coerceConfig` / `e2e/fixtures/harness.ts` |

---

## 2. Contract（src/shared/ipc.ts）変更

| チャンネル / 型 | 変更 | 内容 |
|---|---|---|
| `AppConfig.sidebarWidth` | **ADD** | `number`。既定 260。Renderer が読むので `AppConfig` でよい。書き込みは `mouseup` の1回だけ |
| `AppConfig.themeName` | **ADD** | `string`。既定 `''`（未設定 = 保存済み `theme` が勝つ）。**`'custom'` の番人値を最初から型に入れる**（後から足すと `coerceConfig` を2回触る） |
| `AppAction` | **ADD** | サイドバー幅の3操作（広げる / 狭める / 既定に戻す）。**アクセラレータは持たない**（メニューからのみ） |
| フルスクリーンの通知 | **ADD** | Main → Renderer の1方向イベント。`IpcEvent` に足す |
| `TerminalTheme` | **変更しない** | 変えると `coerceConfig` と `toXtermTheme` が同時に壊れる |
| ウィンドウ状態 | **追加しない** | Main プロセス内で完結（Renderer は読まない）。`preload` にも1行も足さない |

**新規 IPC チャンネルは不要。** すべて既存の `config` / `app-action` / `IpcEvent` に載る。

---

## 3. 技術的制約・前提条件

### CLAUDE.md の鉄則から

- **鉄則2（PTY の出力を加工しない）**: D（サイドバー幅）は SIGWINCH 経由で子プロセスに干渉する。ゴースト方式（下記 D-2）を**受け入れ条件**として PR に書く
- **鉄則3（IPC の正は `src/shared/ipc.ts`）**: `sidebarWidth` / `themeName` は `ipc.ts` → `defaults.ts` → `config.ts` の `coerceConfig` の順に足す。型が通らなくなるので片方だけ書いて止まることはない
- **鉄則5（パース失敗で落とさない）**: `THEME_PRESETS[name]` が `undefined` になる経路を必ず潰す（`shared/theme.ts` の `hexToRgb` が `null` を返して縮退している前例と同じ書き方）

### 実コードで確認した波及経路（2026-08-03）

**`configSet` は全ウィンドウへブロードキャストし、その先で xterm のテーマが再代入される。**

```
main/config.ts registerConfigHandlers -> broadcastConfig -> App.tsx の config.onChange(setConfig)
  -> coerceConfig が毎回新しいオブジェクトを組み立てるので config.theme の参照が変わる
  -> App.tsx の useEffect([config.theme]) が setProperty を4回
  -> TerminalPane の theme={config.theme} -> useTerminal.ts の useEffect が
     全ペインで term.options.theme = toXtermTheme(...) を再代入
```

したがって:

- **D の永続化は `mouseup` の1回だけ。** ドラッグ中に `configSet` を呼ぶとフレームごとに全ペインのテーマ再代入が走る
- **F-3（ウィンドウ状態）をこの経路に載せてはいけない**（resize / move は連続イベント）

**レイアウト変更 → SIGWINCH の経路**（既知だが実コードで再確認済み）:

```
useTerminal.ts の ResizeObserver -> fit() -> clientWidth === 0 の早期 return
  -> fitAddon.fit() -> resizeGate.ts の shouldSendResize()（cols/rows が変わった回だけ通す）
  -> window.api.pty.resize -> main/pty/manager.ts の entry.pty.resize（間引き無し）
```

`.terminal-pane--hidden` は `visibility: hidden` なのでレイアウトを持ち、**幅の変化1回につき `pty.resize` はタブ数ぶん飛ぶ**。

### 絶対に触らないもの（コメントに理由が明示されているものだけ）

| 箇所 | 理由 |
|---|---|
| `.terminal-pane--hidden { visibility: hidden }` | `display: none` にすると ResizeObserver / fit が壊れる。加えて非アクティブペインをアクセシビリティツリーとフォーカス順序から外す（**理由は2つ。両方コメントに残す**） |
| `.tab-bar__close` を `position: relative` の一覧に**入れない** | PR 19 差し戻し。ここで `position: relative` を当てると絶対配置が上書きされて元に戻る |
| `.sidebar` を塗らないこと（塗りは `.sidebar__tabs` / `.sidebar__content` へ） | vibrancy が見えなくなる。かつ S40 の測定値がデスクトップ壁紙依存になる |
| `--surface-tab-active` を `--surface-2` / `--surface-3` に畳む | 畳むと 1.23 → 1.13 で悪化。design-rules の却下済み一覧 |
| `--border-control: #7a7a7a` を `#747474` に下げる | `--surface-tab-active #2e2e2e` の上では 2.91 で 3:1 を割る |
| `styles.css` に `transition` を入れる | ResizeObserver が遷移中に何度も発火して SIGWINCH が飛ぶ |
| `useTerminal.ts` の `toXtermTheme` を `getComputedStyle` 経由にする | `shared/theme.ts` 冒頭「絶対に守ること（鉄則2）」 |
| `useTerminal.ts` の effect 依存配列 `[containerRef]` | `options.theme` を足すと Terminal が再生成されスクロールバックが全消え |
| `main.tsx` の import 順（xterm.css → styles.css） | コメントに理由あり |
| `e2e/screenshots.spec.ts` の `opacity: 0` 方式 | #10 の再発防止。`visibility: hidden` だと IME の composition が消える |

---

## 4. 設計判断履歴

### 4.1 レビューで壊れた前提（2026-08-03・5ペルソナ）

| # | 案の記述 | 実際 | 指摘人数 |
|---|---|---|---|
| 1 | A-1 は「フローから外すだけ」で済む | **済まない。** `.history-item__action` に `pointer-events: none` が無く、絶対配置にすると不可視のボタン（と `::before` の 24px 当たり判定）がタイトルの上に浮き、**タイトル右端をクリックすると resume ではなく「編集」が発火する**。`.tab-bar__close` は同じ失敗モードを `pointer-events` で潰した実績があり、そのコメントに明記されている | **4人** |
| 2 | A-1 は PR #108 と同型 | **同型ではない。** #108 は `.tab-bar__tab-button` に `padding-left: calc(14px + var(--sp-2))` を入れて**視覚上の開始位置を維持した**のが本体で、**1px も幅を回収していない**。A-1 は幅を回収するので `.history-item__title` の省略位置が動く。**「見た目を変えない」は成立しない** | 2人 |
| 3 | D-4「CSS の min/max を外してドラッグ側でクランプ」 | **#118 を壊す。** インラインスタイル（1,0,0,0）は `.sidebar.is-collapsed`（0,2,0）に**必ず勝つ**ので `Opt+Cmd+S` で畳めなくなり S72 が落ちる | 2人（独立・同じ理由） |
| 4 | F-1 の3つの根拠 | **3つとも誤り。** (a) `body { background: var(--surface-1) }` が不透明 + `backgroundColor: SURFACE.base` 明示で **vibrancy は一度も見えていない疑い**、(b) 信号機の光学中心は 22 ではなく **23**（16 + 14/2）で「44px = 22×2」は二重に誤り、(c) `.sidebar__drag-region` は `.sidebar` の子で**端末の列に1px も掛かっていない**ので 40→36 は端末に 0 行しか返さない = 原則3の問題ではない | **3人** |
| 5 | B-1 は「メモだけが2つの `<h2>` を持つ」 | **タスクも持っている。** `TaskList.tsx` の `task-group__heading`（あなたの番 / 作業中）と `panel-empty__heading`（Claude CLI が見つかりません）。しかも `.task-group__heading` と `.history-list__heading` は **CSS 宣言が完全一致**しており、B で3個目・4個目を足すと「見出しの見た目」の正が4箇所に散る | **3人** |
| 6 | E-1 の理由「無反応に見える状態を作る」 | **無反応ではない。** `useTerminal.ts` は `chromeSafeToApply` を見ずに `term.options.theme` を**無条件で**適用するので、実際は「**端末だけ明るくなり、サイドバー・タブバー・padding 帯が暗いまま残る半適用**」。何も起きないより強い故障に見える | 2人 |
| 7 | E-4「2.03 → 2.53」 | **1.96 → 2.45。** 紙のコントラスト表の誤りの**4件目**（design-rules が3件記録済み） | 2人 |
| 8 | 導入計画の画像列 合計 28 枚 | **`docs/images/` は 13 枚しかない。** しかも撮影は `e2e/screenshots.spec.ts` 1本の全撮り直しなので、周別の枚数配分に運用上の意味がない。E は12枚ではなく **S31 の1枚**だけ | 1人 |
| 9 | B の表「履歴 = 起動時 cwd 配下のみ」 | **誤り。** `lib/cwd.ts` の `setSharedCwd` が `useTabs.ts` のポーリングで**アクティブペインの実 cwd** に更新され、`HistoryList` が購読している。**「このフォルダ」は `cd` で黙って変わる** | 2人 |
| 10 | C の理由3「E2E 38 箇所」 | 事実としては概ね正しい（実測 28ファイル / 44箇所、うち日本語リテラル特定 39）が、**デザイン判断の根拠に使ってはいけない**（テストが仕様を凍結する先例になる）。理由1（幅）と理由2（語の反転）で十分 | 1人 |

### 4.2 矛盾した指摘の裁定

| 論点 | 対立 | 採った結論と理由 |
|---|---|---|
| **E-4（selectionBackground）** | macOS「#2f5d8f への引き上げは賛成」 vs a11y「退行なので撤回」 | **却下・据え置き。** 3人が独立に「選択範囲の塗りは 1.4.11 の対象ではない」と結論した。拘束するのは**塗りの上のテキストの 1.4.3** で、`#2f5d8f` にすると既定前景 `#d4d4d4` が 5.73 → **4.60 に悪化**し、ANSI 16 色のうち 3:1 未満が 9 → **11 色に増える**。改善ではなく退行。**多数決ではなく、結論を支えている数値を採った**（run-review.md の規律） |
| **G の色** | macOS「`box-shadow: inset 0 0 0 1px var(--border-control)` の角丸カプセル輪郭」 vs a11y「白（`--focus-ring`）」 | **白を採る。** `--border-control` #7a7a7a は `prefers-contrast: more` の面（#525252）で **1.82** に落ち、「消えるのが高コントラスト側だと、高コントラストモードの利用者だけが壊れる」（design-rules）に正確に該当する。白は 13.58 / 7.81 で、1〜3型すべてで比が1ミリも動かない |
| **G の形** | macOS「下線は PR 19 で捨てた Material の語彙。Safari / Terminal.app は塗り + 角丸 + セパレータ消失で表す」 vs a11y「下辺 2px なら 2.4.13 のフォーカス有無の差が保てる」 | **下辺のみ 2px。** 4辺白にするとフォーカスリング（`outline: 2px solid var(--focus-ring); outline-offset: -2px`）と**区別できなくなる**。macOS の語彙からの逸脱は、design-rules が「サイドバーを明るくしない」を意図的な HIG 逸脱として記録しているのと**同じ形で記録する**（記録しないと毎回同じ指摘が出る） |
| **A-3（メモ/編集の常時表示）** | IA「absolute + `visibility: hidden` + `:focus-within`」 vs power-user / macOS / a11y「常時表示にしない」 | **常時表示にしない。かつ `visibility: hidden` も採らない。** `visibility: hidden` の要素は**フォーカスを受けられない**ので `:focus-within` が発火できず、キーボードからメモへの唯一の入口が消える（両レビュアーが見落とした）。`.tab-bar__close` の前例どおり **`opacity: 0` + `pointer-events: none`、hover / focus で `auto`** が正しい。a11y 専門家は「常時表示にしても読み上げ側は1文字も変わらないので、A-3 の判断材料から a11y は落としてよい」と明言している |
| **F-1 の高さ** | 36 / 40 / 44 の3案 | **36px + `trafficLightPosition: { x: 16, y: 11 }`。** `y = (36 − 14) / 2 = 11` で信号機の中心が 18、36px 帯の中心も 18、タブバーのテキスト中心も 18。**3つが初めて一致する。** 44px 案は「22 × 2」という誤った算術の産物。ただし**前段として vibrancy の生死の実機確認が要る** |
| **D のキーボード代替** | — | **「表示」メニューに `サイドバーを広げる` / `狭める` / `既定の幅に戻す` の3項目。キーは新設しない。** macOS / power-user / a11y の**3人が独立に完全に同じ答え**に到達した。`menu.ts` の `分割比を広げる / 狭める / 50%に戻す`（`accelerator: undefined`）が前例。幅調整は 2〜5回/日で初日以降ほぼ0なので、100手/日級の操作に使えるキー帯域を渡す対象ではない。WCAG 2.5.7（Dragging Movements）の Equivalent としても成立する |
| **D-2 / D-3（fit の間引き・transition 禁止）** | — | **不要になる。** `PaneSplitterHandle.tsx` が `position: fixed` のゴースト線だけを動かし、**ドラッグ中は flex-grow を1回も変えず** `mouseup` で1回だけコミットする方式を確立している。同じ形にすれば ResizeObserver がそもそも発火しないので、`pty.resize` は **0 回** |
| **F-3 の保存先** | `config.json` か別ファイルか | **`src/main/window-state.ts`（新規）+ `window-state.json`。** 理由は (i) `setConfig` → `broadcastConfig` → 全ペインのテーマ再代入という経路があり、ウィンドウを掴んで動かすたびにこれが走る、(ii) `setConfig` は毎回 `JSON.stringify(next)` で全書き換えする、(iii) 設定 UI に出さない項目を `AppConfig` に足すと S70 の情報設計と型がずれる、(iv) `memo/store.ts` と `history/titles.ts` という前例が2つある。**`ipc.ts` にも `preload` にも1行も足さずに Main 内で完結する**（鉄則3の観点でも軽い） |

### 4.3 周の分割（原則4: 置換と値の変更を混ぜない）

| 周 | 内容 | 値/見た目を変えるか | 画像 |
|---|---|---|---|
| **1** | **関門を先に置く。** `.panel-heading` への畳み込み / `--bar-height` トークン化 / 帯の高さの characterization / S40 に `selectionBackground` と「選択中タブの線」/ 履歴行の `elementFromPoint` assert | **変えない。`make css-substitution-check` PASS が受け入れ条件** | 0 |
| **2** | A（`pointer-events` + `.history-item__actions` の絶対配置 + meta の ellipsis） | 変える（省略位置が動く） | 3（S16/S18/S19） |
| **3** | B（`<h1>` + 見出し階層 + タスク/メモのスコープ行 + 履歴の二重化解消 + meta のフォルダ名）+ C の結論の記録 | 変える | S01/S12/S13 系 |
| **4** | D（`clampSidebarWidth` + ゴーストハンドル + `--sidebar-width` + メニュー3項目 + 永続化） | 既定幅は変えない | 0 |
| **5** | F（vibrancy 確認 + 帯 36px + `y: 11` + フルスクリーン + `window-state.json` + `setTitle`）+ G（白の下辺線）+ state slot の配線 | 変える | **12（1回にまとめる）** |
| **6** | E（`shared/themes.ts` + `themeName` + 設定 UI + `removeProperty` バグ修正） | 既定テーマは1バイトも変えない | 1（S31） |

**周5 に F と G を同居させる**のは、両方とも全画面に効くため。画像12枚の撮り直しを1回で済ませる（power-user の異議2）。**ただし PR は F と G で分け、S40 / S41 の diff で理由を分離できるようにする**（macOS / maintainer の指摘）。

### 4.4 検証の運用（`make e2e` を最後に1回だけにするリスクへの対処）

maintainer の指摘: **現在の 70 spec は A-1 の当たり判定・F-1 の帯の高さ・G の線・`selectionBackground` を1本も見ていない。最後に `make e2e` を回しても緑のまま通る。** したがって緩和は「E2E の回数」ではなく「関門を先に置く周（周1）」。

加えて:

- **`make e2e-lint` は毎周回す**（数秒）
- **`make e2e-screenshots` はセレクタを変えた周ごとに回す。** `e2e/screenshots.spec.ts` は `e2e/screenshots.playwright.config.ts` 経由でしか走らず、`playwright.config.ts` の `testDir: ./e2e/specs` から外れている（#90 の再発経路）
- **各周の終わりに、その周が触った領域の spec だけを名指し実行する**（`npx playwright test e2e/specs/S44 e2e/specs/S72 ...`）。5周ぶんの CSS 変更をまとめて1回の `make e2e` に当てると、落ちた spec がどの周由来か切り分けられない（design-rules に帰属を誤った実例あり）
- **`src/` を壊して確かめる検証は `make e2e` で行う**（単体で spec を回すと既存の `out/` を見てしまい、壊した版が入っていない）
