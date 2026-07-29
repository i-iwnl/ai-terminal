# Architecture

Issue #25 における変更対象の構造。
設計判断の根拠は末尾の「設計判断履歴」を参照。

---

## 1. 対象トラック

main（ウィンドウ生成・設定の配信）+ renderer（描画の切り替え）の2トラック。

| コンポーネント | 変更内容 | 影響範囲 |
|---|---|---|
| `src/main/settings-window.ts` | **新規**。生成・多重防止・開閉の IPC | `src/main/index.ts` / `menu.ts` |
| `src/main/config.ts` | 変更（`config:set` の後に全ウィンドウへ配信） | 本体ウィンドウの再描画 |
| `src/main/menu.ts` | 変更（「設定...」は Main 側で完結。Renderer を経由しない） | - |
| `src/renderer/src/main.tsx` | 変更（`#settings` で描画を切り替え） | - |
| `src/renderer/src/settings/SettingsWindow.tsx` | **新規**。設定ウィンドウのルート（config の取得・保存） | - |
| `src/renderer/src/settings/SettingsPanel.tsx` | 変更（backdrop / dialog ラッパーを撤去、`Cmd+W` を追加） | `styles.css` |
| `src/renderer/src/lib/defaults.ts` | **新規**。`FALLBACK_CONFIG` を本体と設定ウィンドウで共有 | `App.tsx` |
| `src/renderer/src/App.tsx` | 変更（モーダルの state と描画を撤去、`config:changed` を購読） | - |
| `src/renderer/src/styles.css` | 変更（`.settings-backdrop` / `__head` / `__title` / `__close` を削除、`--window` を追加） | - |
| `e2e/fixtures/harness.ts` | 変更（`openSettingsWindow()` ヘルパ） | S31 / S32 / S35 / screenshots |

---

## 2. Contract（src/shared/ipc.ts）変更

| チャンネル / 型 | 変更 | 内容 |
|---|---|---|
| `IpcSend.settingsOpen` / `settingsClose` | ADD | 開閉要求。戻り値は不要なので send |
| `IpcEvent.configChanged` | ADD | `config:changed`。設定変更を**全ウィンドウ**へ配信 |
| `RendererApi.settings.open` / `.close` | ADD | - |
| `RendererApi.config.onChange` | ADD | 購読解除関数を返す |

---

## 3. 技術的制約・前提条件

- **ビルドの入力（HTML）を増やさない。** 本体と同じバンドルを `#settings` 付きで読み込み、`main.tsx` で描画を切り替える。`electron.vite.config.ts` の `rollupOptions.input` を触らずに2つ目のウィンドウを作るための割り切り
- **設定ウィンドウは別の Renderer。** モーダルだった頃は同じ React ツリーだったので `setConfig` で本体に反映されたが、**別ウィンドウでは届かない。** Main が `config:set` の後に全ウィンドウへ配信する必要がある（配信を忘れると「設定を変えてもターミナルに反映されない」形で表に出る。実際に E2E S31 が赤くなって気づいた）
- **`modal: true` にしない。** 非モーダルであることが今回の要点。`parent` は指定して前後関係だけ揃える
- **`Cmd+W` は設定ウィンドウ側の keydown で処理する。** メニューの「タブを閉じる」は本体のタブを対象にしており、かつ accelerator は表示専用（`registerAccelerator: false`）なので設定ウィンドウには効かない
- **E2E: `Escape` / `Cmd+W` の `press()` は reject しうる。** 押した瞬間にページが閉じるため。閉じたことは `app.windows().length` で判定する
- **スクリーンショットは幅 520px の窓を 1200px に引き伸ばさない。** `annotateAndShoot` に `targetWidth` を足し、設定は 620px で保存する

---

## 4. 設計判断履歴

| 日付 | 判断 | 根拠 | 代替案 |
|---|---|---|---|
| 2026-07-29 | モーダルをやめて独立ウィンドウにする（**ユーザー判断**） | macOS 13 以降の作法。フォーカストラップ・Esc の自前処理・背景クリック判定・backdrop が**すべて不要になり、実装量はむしろ減る**。#25 の問題3つが構造ごと消える | `.app` 直下へ移して `position: fixed` にし、初期フォーカス・トラップ・復帰を自作する（#20 の D で結局ウィンドウ化するなら二度手間） |
| 2026-07-29 | 同じバンドルを `#settings` で読み込む | ビルドの入力を増やさずに2つ目のウィンドウを作れる。React の bootstrap も1本で済む | `settings.html` を別エントリにする（`electron.vite.config.ts` と `main.tsx` 相当がもう1組増える） |
| 2026-07-29 | `config:changed` を全ウィンドウへ配信する | 別 Renderer になった以上、設定の変更は Main を経由しないと本体に届かない。**これを入れ忘れて E2E が赤くなった**（フォントサイズが 13px のまま） | 設定ウィンドウから本体へ直接送る（Renderer 間の直通経路は無い） |
| 2026-07-29 | メニューの「設定...」は Main 側で完結させる | 設定ウィンドウの生成は Main の責務。Renderer を1往復させる意味が無い | `AppAction` を経由する（本体ウィンドウが無い状態では動かない） |
| 2026-07-29 | `FALLBACK_CONFIG` を `src/renderer/src/lib/defaults.ts` に切り出す | 本体と設定ウィンドウの両方が使うため、どちらかに置くと二重化する | 設定ウィンドウ側にもう1つ書く（三重化になる） |
| 2026-07-29 | `Main` 側の `DEFAULT_CONFIG` との二重化は**今回は解消しない** | `src/shared/` へ寄せるのは #20 の PR 1 のスコープ。#25 に混ぜると差分が読めなくなる | ここでまとめてやる |
