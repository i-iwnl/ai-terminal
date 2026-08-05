# Architecture

Issue #180 における変更対象の構造。
設計判断の根拠は末尾の「設計判断履歴」を参照。

---

## 1. 対象トラック

単一トラック。ただし周によって重心が入れ替わる。

| コンポーネント | 変更内容 | 影響範囲 |
|---|---|---|
| `src/renderer/src/styles.css` | 変更（引き継ぎ周5-b / #180 周8） | `docs/images/` の撮り直し判定・`S40` / `S41` の実測固定 |
| `src/renderer/src/components/TabBar.tsx` | 変更（引き継ぎ周5-b / 周7 / #180 周8） | `S06` / `S51` / `S54` / `S64` / `S95` |
| `src/main/menu.ts` | **完了**（#180 周3 = #152 / #145。PR #208 / #209） | 判定は `src/main/menu-action-routing.ts` へ切り出し済み。**この面はいま空いている** |
| `src/main/menu-action-routing.ts` | 新規（#180 周3 = #152） | `test/unit/menu-action-routing.test.ts` が唯一の関門（**E2E からは踏めない**。`known-issues.md` 6番） |
| `src/main/window-state.ts` | 変更（#180 周4 = #153） | 既存 `window-state.json` の後方互換 |
| `e2e/` | 追加（周ごと） | `scenarios.yml` との1:1（`make e2e-lint`） |

---

## 2. Contract（src/shared/ipc.ts）変更

現時点では**なし**。

- #149（VoiceOver 検知の表示）は既存の検知結果を設定ウィンドウへ出すだけで済むかを周4 で確認する。
  **新チャンネルが要ると分かった時点でこの節に追記する**（`/electron-ipc` を読む）

---

## 3. 技術的制約・前提条件

- **`:root` にリテラル hex を置かない / 本体に色リテラルを書かない**（どちらも単体テストが落とす）。
  値を変える周では `make css-substitution-check` が落ちてよいが、**落ちた行がトークンの行だけ**であることを確認する
- ⛔ **アクセント色でハイライトしない**（`design-rules.md` の却下1.70）
- ⛔ **`--focus-ring` の白 = 選択中**。他の用途に白を使わない
- ⛔ **`scrollIntoView` には `block: 'nearest'` を必ず付ける**（付けないと #170 と同じ「タブが上に押し出される」を再生産する）
- ⛔ **`.main` に `overflow` を足すと `.notice-list` が #170 と同型で全消えする**（`S55` は `toBeVisible()` 系なので気づかない）
- **数値を CSS のコメントに書かない**（実測の正は `S40` / `S41`）
- ルート CLAUDE.md の鉄則（Renderer は OS を直接触らない / PTY 出力を加工しない / IPC は `src/shared/ipc.ts` が唯一の正）

---

## 4. 設計判断履歴

| 日付 | 判断 | 根拠 | 代替案 |
|---|---|---|---|
| 2026-08-05 | #179 の周5-b / 周7 を **#180 のループへ引き取る** | 「open な Issue = エージェントが進められるもの」を保つ。#179 は対象7件を全 close して閉じており、追跡だけのために reopen すると open 件数の意味が濁る | #179 を reopen する / 新規起票する（⛔ 掟で禁止） |
