# Architecture

Issue #20（デザイン刷新）の構造。Phase ごとに追記する。
設計判断の根拠は末尾の「設計判断履歴」を参照。

---

## 1. 対象トラック

単一トラック（renderer）が基本。テーマの導出（PR 17-18）とウィンドウ状態の復元（PR 20）は main も触る。

Phase 1（トークン層）で触るもの:

| コンポーネント | 変更内容 | 影響範囲 |
|---|---|---|
| `src/shared/defaults.ts` | **新規**（PR 1）。設定の既定値の唯一の正 | main / renderer の両方 |
| `src/main/config.ts` | 変更（PR 1）。自前の既定値を捨てて shared を参照 | - |
| `src/renderer/src/styles.css` | 変更（PR 2-5）。トークンの宣言 -> 置換 -> 値の変更 | 画像12枚（PR 5 のみ） |

---

## 2. Contract（src/shared/ipc.ts）変更

Phase 1 では**なし**。`AppConfig` の形は変えない。

Phase 6（テーマ）で `themeName` / `themeFollowsAppearance` を足す予定。`TerminalTheme` の形は変えない
（変えると `coerceConfig` と `toXtermTheme` が同時に壊れる）。

---

## 3. 技術的制約・前提条件

- **「変数に置き換える PR」と「値を変える PR」を混ぜない。** 混ぜると、画像が変わった理由が
  置換ミスなのか意図なのかレビューで分離できない。分ければ置換 PR は画像0枚で済む
- **色の単一の正は TypeScript 側に置き、CSS 変数はそこから流し込む。**
  xterm の `ITheme` を `getComputedStyle` で CSS 変数から読んではいけない（CSS が壊れると
  端末の色が壊れる経路ができ、鉄則2の境界が CSS 側に漏れる）
- **`.terminal-pane__container { padding: 4px }` があるため、CSS 側のターミナル背景色だけを
  変えると xterm が塗る領域の外周4pxに色の違う帯が出る**
- コントラストは**最も明るい面（モーダル / 設定ウィンドウ）でも**検証する。暗い面だけで通しても意味がない
- 触ってはいけない箇所は Issue 本文の「絶対に触らないこと」が唯一の正

---

## 4. 設計判断履歴

| 日付 | 判断 | 根拠 | 代替案 |
|---|---|---|---|
| 2026-07-29 | Phase 0 を Issue 本文のチェックリストではなく個別 Issue に切り出す | `enhancement` の中に不具合が埋もれると、個別に着手・クローズできない。実際 5件とも独立した PR になった | 親 Issue のチェックリストにする |
| 2026-07-29 | Phase 0 の5本を積み重ねる（stacked PR） | 画像12枚を毎周撮り直すため、独立させるとマージ時に必ず衝突する | 並列に出す |
| 2026-07-29 | PR 1 で `src/shared/defaults.ts` を作り、`coerceConfig({})` の一致を単体テストで固定する | 設定項目を増やすとき、型が守るのは `AppConfig` と `DEFAULT_CONFIG` だけで、**`coerceConfig` への追加漏れは型では検出できない**（返り値の型は満たしたまま、その項目だけ常に undefined になる） | 目視で気をつける |
