# Known Issues

実装中に発見された未解決のバグ・先送りした課題。
詳細な観察記録は `worklog.md` を参照。

---

## 1. この Issue では扱わないと決めたもの（別 Issue の候補）

5ペルソナのレビューで見つかったが、Issue #130 のスコープ（ペインに名前を出す）から
外れるもの。**すべて実コードの行番号付きで確認済み。**

| # | 内容 | 根拠 | 優先度 |
|---|---|---|---|
| **X1** [#132](https://github.com/i-iwnl/ai-terminal/issues/132) | **`Cmd+J` がペインに着地しない。** `App.tsx:554-566` が `findNextYourTurnTab()` の結果を `setActiveTabId` に渡すだけで、どのペインが「あなたの番」かを見ていない。OS 通知の経路（`App.tsx:769`）は `findPaneByAgentSessionId()` -> `setActivePaneInTab()` で**ペインまで着地している**のに、より高頻度な `Cmd+J` にだけ同じ教訓が適用されていない | ヘビーユーザー。`Cmd+J` の想定頻度は `shortcuts.ts:251` 自身が 100〜200回/日と見積もっている。**削減 20〜100手/日 + 誤入力の消滅**（`Cmd+J` 直後に返事を打ち始めるので、着地が隣のペインだと**返事が別プロセスの stdin に入る**） | **P1** |
| **X2** [#133](https://github.com/i-iwnl/ai-terminal/issues/133) | **異常終了が第0層（アプリの外）に1つも出ない。** `poller.ts:204-205` の Dock バッジは `countYourTurn(tasks)` のみで exit を数えない | ヘビーユーザー / macOS。`severityForExit()`（`notices.ts:35-38`）が `'error'` を返す終了に限り、**非フォーカス時のみ** `app.dock.bounce()`。`poller.ts:277-279` の既存の判定をそのまま流用できる。**ウィンドウ内に層を何枚積んでも、14:00 に落ちて 15:30 に気づく1時間半は1分も縮まない** | P2 |
| **X3** [#134](https://github.com/i-iwnl/ai-terminal/issues/134) | **`--status-exited` #d47b7b が 1.4.3 を割っている。** 選択中タブ `--surface-tab-active` #2e2e2e の上で **4.47**、`prefers-contrast: more` の #525252 の上で **2.57** | a11y の実測。**壊れるのが高コントラスト側**なので、高コントラストを求めた利用者だけが壊れる。`@media (prefers-contrast: more)` に `--status-exited: #f0b8b8`（4.56）を1行 | P2 |
| **X4** [#135](https://github.com/i-iwnl/ai-terminal/issues/135) | **コンテキストメニューがアプリ全体に0件**（`src/main/` `src/renderer/src/` で `contextmenu` / `Menu.popup` が0）。Terminal.app も iTerm2 も Ghostty も、ターミナル面の右クリックはメニューを出す | macOS。ペイン右クリックで「右に分割 / 下に分割 / ペインを閉じる / ペインを最大化 / 名前を変更」。**すべて `ipc.ts:473,479,492` の `AppAction` に既存**なので、新しい能力を1つも作らずに Mac らしさの最大の欠損が埋まる | P2 |
| **X5** [#136](https://github.com/i-iwnl/ai-terminal/issues/136) | **`useTerminal.ts:211` の in-pane 終了行にテストが1本も無い**（`grep -rn "プロセスは" e2e/` = 0件） | 保守。**いま唯一のペイン単位の永続表示が無防備** | P2 |
| **X6**（残り分 = [#137](https://github.com/i-iwnl/ai-terminal/issues/137)） | **README の3箇所が実装と食い違う。** `:283`「アクティブなペインはペインヘッダの文言で分かる」（`.pane-header` にアクティブ状態の CSS 規則は1つも無く、文字列も全ペイン同一）、`:299`「分割で作ったシェルがエージェントの現在地とずれることがある（ペインヘッダの cwd 表示で気づける）」（エージェントペインの cwd は `useTabs.ts:175` でポーリング対象外なので気づけない）、`zsh` ハードコードが `$SHELL` を反映しない | IA。`make e2e-screenshots-check` は文章のずれを検出しない。**Issue #130 の周4（README 更新）で :283 と :299 に触れる可能性がある** | **P1** |
| **X7** [#138](https://github.com/i-iwnl/ai-terminal/issues/138) | **`.pane-header` の 18px が3箇所にリテラルで散っている**（`styles.css:1036` `flex` / `:1037` `height` / `:1055` `.terminal-search` の `top`）。**どの spec も守っていない**（`S56:150-200` は検索バーの左右のはみ出しだけを測り、縦の重なりを見ていない） | 保守。`--pane-header-height` へトークン化し、`test/unit/css-tokens.test.ts:270-278` の `--bar-height` / `.notice-list` と**同型の突き合わせ**を足す。**CLAUDE.md の「置換と値の変更を混ぜない」に従い、置換だけの周として単独 PR にする** | P2 |
| **X8** [#131](https://github.com/i-iwnl/ai-terminal/issues/131)（**実装済み**） | **タブバーの見出し・プロバイダ色・ツールチップ・ウィンドウタイトルが、すべてアクティブなペインから引かれている。** `Cmd+]`（`shortcuts.ts` 自身が 40〜80回/日と見積もる）のたびに4つとも書き換わる。`App.tsx:376-380` は「Mission Control / ウィンドウメニュー / App Exposé に出る名前だけが『どのウィンドウがどのプロジェクトか』の手がかり」と書いているが、**分割中はその目的が消える** | IA / a11y / ヘビーユーザーが (b)「先頭 leaf に固定」で一致（3:2）。macOS / 保守は (a) 維持。**Issue #56 `known-issues.md:63` の宿題そのもの** | **P1** |
| **X9** [#139](https://github.com/i-iwnl/ai-terminal/issues/139) | **`.pane-header` が `S40-contrast-contract.spec.ts` の測定対象に入っていない**（grep 済み・0件）。`--text-secondary` on `--surface-2` は一度も実測されていない | a11y / 保守。`design-rules.md`「配色を守るのは S40 / S41。それ以外の E2E は色をほとんど見ていない」 | P3 |

### X6 の進捗（2026-08-04）

**`:283` と `:299` は Issue #130 の周4 で直した。**

- `:283`「アクティブなペインはペインヘッダの文言で分かる」-> **削除**（`.pane-header` に
  アクティブ状態を表す CSS 規則は1つも無く、文字列も名前を付けるまで全ペインで同一）
- `:299`「分割で作ったシェルがエージェントの現在地とずれる（ペインヘッダの cwd 表示で
  気づける）」-> **「このずれはヘッダを見ても分からない」に訂正**し、`pwd` を打つ手段を示した

**残っているのは `zsh` ハードコードが `$SHELL` を反映しない点だけ**（`paneHeader.ts:37` の
`PTY_KIND_LABEL.shell = 'zsh'`。`shared/defaults.ts` は「shell は未指定なら `$SHELL`」なので、
fish / bash の利用者にも `zsh` と表示される）。IA ペルソナは「同一物を3つの語で呼んでいる」
（`新しいシェル` / `シェル` / `zsh`）ことも指摘している。

---

## 3. Issue #130 の実装中に新しく見つかったもの

| # | 内容 | 優先度 |
|---|---|---|
| **X10** [#140](https://github.com/i-iwnl/ai-terminal/issues/140) | **状態語「終了」がリテラルで3箇所に散った。** `TabBar.tsx:335`（aria ラベル）/ `:443`（バッジ）に加え、Issue #130 で `paneHeader.ts` の `paneAccessibleLabel` が3箇所目になった。`closeTabCopy.ts:66` の `PERSIST_SETTING_LABEL` が定数化の前例だが、寄せると `TabBar.tsx` の WCAG コメント塊に手を入れることになるためスコープ外にした。**文言がずれても機械では検出されない** | P3 |
| **X11** [#141](https://github.com/i-iwnl/ai-terminal/issues/141) | **`react-hooks/exhaustive-deps` が eslint に設定されていない。** `// eslint-disable-next-line react-hooks/exhaustive-deps` を書くと `Definition for rule was not found` で **lint が落ちる**。ルール自体が無いので、依存配列の取りこぼしは**機械では一切検出されない**（`useTerminal.ts:231` / `TabBar.tsx` の登録 effect のように、意図的に絞っている箇所とそうでない箇所を人間が読み分けるしかない） | P3 |

### ステータス

**全件起票済み**（2026-08-04）。#131 / #132〜#141。状態の唯一の正は各 GitHub Issue。
ここの記述は**観察の記録**として残す（対処済みでも消さない）。

---

## 2. 実装前に確認済みの「壊れていないもの」

**調べた結果、問題が無かったもの。** 次に同じ疑いを持ったときに再調査しないための記録。

| 対象 | 結論 |
|---|---|
| `markExited`（`useTabs.ts:456`） | `flattenPaneTree` で木の全 leaf を走査しており、**非アクティブペインの exit も正しく記録している**。壊れているのは表示側だけ |
| `App.tsx:807-810` の終了通知 | `flattenPaneTree(...).find(l => l.ptyId === event.ptyId)` で**終了した leaf を正しく解決している**。per-pane で既に正しい前例 |
| `tabHasYourTurn`（`TabBar.tsx:330` -> `tabYourTurn.ts:61-63`） | `flattenPaneTree` を使い**既に木の全 leaf を見ている**。「あなたの番」は分割中も持続表示されている |
| `isEditableTarget`（`shortcuts.ts:89`） | `tagName === 'INPUT'` の汎用判定なので、リネーム入力欄は**ただでグローバルショートカットから守られる**（`S46` が固定） |
| `styles.css` の `transition` / `animation` / `@keyframes` | **宣言は0件**（ヒットはすべてコメント）。`prefers-reduced-motion` を足す提案は `design-rules.md` §5 で却下済み |
| `menu.ts:199-205` の `role: 'reload'` / `toggleDevTools` | `isDev()` に囲われており、本番の `Cmd+R` 事故は無い |
