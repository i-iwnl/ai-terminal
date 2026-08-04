# Architecture

Issue #161 における変更対象の構造。
設計判断の根拠は末尾の「設計判断履歴」を参照。

---

## 1. 対象トラック

**単一トラック（renderer 主体）**。#152 は main のみ、#155 は main + shared に及ぶ。

| コンポーネント | 変更内容 | 影響範囲 | 周 |
|---|---|---|---|
| `e2e/specs/S40-contrast-contract.spec.ts` | 追加（`.pane-header` の2エントリ） | `e2e/scenarios.yml` の note | 1 |
| `e2e/fixtures/harness.ts` | 追加（`LaunchOptions` に spawn 失敗モード） | `e2e/specs/S55-notice-severity.spec.ts` | 1 |
| `src/renderer/src/tabs/TabBar.tsx` / `paneHeader.ts` | 変更（「終了」リテラル3箇所 → 定数） | `test/unit/pane-header.test.ts` | 2 |
| **`src/main/menu.ts`** | 変更（`actionItem` の `click` にフォーカス判定） | 37箇所すべてに効く。`e2e/scenarios.yml` に新シナリオ | 3 |
| `.claude/skills/e2e/reference/limitations.md` | 追加（dev/prod メニュー差の手順） | `lint-skills.sh` | 3 |
| **`src/main/window-state.ts`** / `settings-window.ts` | 変更（設定ウィンドウ分のキーを追加） | 既存の `window-state.json` との互換 | 4 |
| `src/renderer/src/settings/SettingsPanel.tsx` / `SettingsWindow.tsx` | 追加（検知の表示） | `S31` / `S70` | 4 |
| **`src/main/accessibility.ts`** | 変更（変化イベントの宛先を増やす。**分割可**） | 設定ウィンドウを開いたままの追従 | 4 |
| `src/renderer/src/terminal/useTerminal.ts` / `TerminalPane.tsx` | 追加（textarea の `aria-label`） | `S37` | 5 |
| **`src/main/pty/manager.ts`** / **`src/shared/ipc.ts`** | 変更（gemini に `--session-id`） | `test/unit/pty-plan.test.ts` / `closeTabCopy.ts` / README / `pty-pitfalls.md` | 6 |
| `.claude/skills/` / `e2e/screenshots.spec.ts` / `App.tsx` / `CloseTabConfirmDialog.tsx` | 変更（コメント5箇所） | `lint-skills.sh` | 7 |

---

## 2. Contract（src/shared/ipc.ts）変更

**周6（#155）で変更する可能性がある。それ以外の周では変更しない。**

| チャンネル / 型 | 変更 | 内容 | 周 |
|---|---|---|---|
| `SpawnPtyRequest` | **ALTER（候補）** | resume 時に履歴側の `stableId`（UUID）を Main へ運ぶ必要がある。既存の `geminiResumeTarget`（index）とは別物なので、フィールドを足すか意味を拡張するかの判断が要る。**事前実測が肯定的だった場合のみ** | 6 |

Contract を変更する周では [/electron-ipc](../../skills/electron-ipc/SKILL.md) を読み、この表を更新すること。

---

## 3. 技術的制約・前提条件

- **IPC のチャンネル名と型は `src/shared/ipc.ts` を単一の正とする**（ルート CLAUDE.md の鉄則3）。周6 で変更するなら起点はこのファイル
- **外部コマンドの出力パースは1ファイルに閉じ込める**（鉄則4）。`gemini --list-sessions` のパースは `src/main/history/reader.ts` の `GEMINI_LINE_RE` だけ。周6 でここを触るなら、他所にパースを漏らさない
- **S40 の閾値は項目名の文字列ヒューリスティックで決まる。** 「塗り」「枠」「ドット」が含まれるかで 3.0 / 4.5 を振り分ける。**#139 の項目名は既存の慣例に揃えること**
- **`contrast.ts` の `effectiveBackground()` は自分自身から親へ遡る。** `background-color` を `against` 無しで測ると自分と比べて 1.0 になる。S40 に同じ罠が3回記録されている
- **`window-state.ts` は `config.json` に入れない判断が済んでいる。** 理由3点（全ウィンドウへのブロードキャストで全ペインの `term.options.theme` が再代入される / 連続イベントで毎回ファイル全書き換え / `S70` が固定している設定 UI の情報設計と型がずれる）が冒頭コメントにある。**周4 はこの判断を踏襲する**
- **設定ウィンドウは独立した `BrowserWindow`** で、本体と同じ preload を読む。ただし `registerAccessibilityHandlers(win)` は**本体ウィンドウ1枚にしか送っていない**
- **`Terminal.strings` は static。** インスタンスごとに別の値を持てないので、周5 は `.xterm-helper-textarea` へ直接 `aria-label` を付ける形を採るのが素直（名前の変更に追随しやすい）

---

## 4. 設計判断履歴

| 日付 | 判断 | 根拠 | 代替案 |
|---|---|---|---|
| 2026-08-04 | **P3 を #160（P1/P2）と分けて別の束ねにした** | #121 の前例が P3 単独。10件あり #160 の10件と合わせると1本では周が20近くになる。分けても衝突するのは2件（#140 / #157）だけで、順序制約として管理できる | #160 に全部入れる |
| 2026-08-04 | **#139 の動機を「未知の値を測る」から「`.pane-header` 固有の宣言の変化を検出する」へ読み替えた** | Issue 本文の「実測値が一度も取られていない」が誤りだった。S40 の `'非選択セグメントの文字（対トラック）': 6.69` が同じ色の組を既に固定している（`.sidebar__tabs button:not(.is-active)` が `background: transparent` で親の `--surface-2` まで遡るため） | 動機のまま着手する（重複した期待値を「新しい実測」として記録してしまう） |
| 2026-08-04 | **#155 に事前実測の関門を置き、否定的なら実装しないことにした** | `--resume` は今も `latest` / index のみ。`--session-id` で渡した UUID が `--list-sessions` の `[UUID]` と一致しなければ、resume 時に tmux セッション名を再現できず案が成立しない。**測る前に実装を始めると、成立しない設計に時間を使う** | 実装してから確かめる |
| 2026-08-04 | **#149 を「表示を出す」と「開いたまま追従する」に分割可能とした** | 前者だけで症状（いま有効なのが分からない）は解消する。後者は `src/main/accessibility.ts` の送信先を増やす別の作業 | 1本でまとめる |
| 2026-08-04 | **#157 を最後の周に置いた** | 直す5箇所のうち3箇所が #158（#160 の周7）と同じファイル。#158 が先に入れば、その PR に畳める分がある | 最初にまとめて直す（#158 の周で再度触ることになる） |
