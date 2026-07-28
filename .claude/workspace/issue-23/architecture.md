# Architecture

Issue #23 における変更対象の構造。
設計判断の根拠は末尾の「設計判断履歴」を参照。

---

## 1. 対象トラック

main（支援技術の検知）+ renderer（xterm への反映と設定 UI）の2トラック。

| コンポーネント | 変更内容 | 影響範囲 |
|---|---|---|
| `src/main/accessibility.ts` | **新規**。`app.accessibilitySupportEnabled` の取得と変化の push | `src/main/index.ts` |
| `src/main/config.ts` | 変更（既定値と `coerceConfig`） | 設定ファイルの読み書き全体 |
| `src/shared/ipc.ts` | 変更（`AppConfig.screenReaderMode` / invoke 1本 / event 1本 / `RendererApi.app` 2つ） | preload・Renderer |
| `src/preload/index.ts` | 変更 | Renderer |
| `src/renderer/src/App.tsx` | 変更（支援技術の state、`config \|\| 検知` を TerminalPane へ） | - |
| `src/renderer/src/terminal/TerminalPane.tsx` / `useTerminal.ts` | 変更（生成時と反映 effect の両方） | - |
| `src/renderer/src/settings/SettingsPanel.tsx` | 変更（「アクセシビリティ」節を新設） | `docs/images/S31-settings-panel.png` |
| `e2e/specs/S37-screen-reader-mode.spec.ts` | **新規** | `e2e/scenarios.yml` |
| `test/unit/config.test.ts` / `README.md` | 変更 | - |

---

## 2. Contract（src/shared/ipc.ts）変更

| チャンネル / 型 | 変更 | 内容 |
|---|---|---|
| `AppConfig.screenReaderMode` | ADD | boolean、既定 false |
| `IpcInvoke.appAccessibilitySupport` | ADD | `app:accessibility-support`。初期値の取得 |
| `IpcEvent.accessibilitySupportChanged` | ADD | `app:accessibility-support-changed`。変化の push |
| `RendererApi.app.accessibilitySupport` / `.onAccessibilitySupportChanged` | ADD | - |

`TerminalTheme` など既存の型の形は変えていない。

---

## 3. 技術的制約・前提条件

- **鉄則2（PTY の出力を加工しない）と衝突しない。** `screenReaderMode` は xterm.js 内部の機能で、アプリ側は ANSI を1バイトも触らない。むしろ「自前でアクセシビリティバッファを実装しない」ための最良の手段であり、**鉄則2はこの機能を有効にすべき理由になっている**
- **鉄則1（Renderer は OS を直接触らない）**: 支援技術の状態は OS の情報なので Main が取る
- **既定 true にしない**: 行が追加されるたびに live region を更新するため描画コストが上がる。AI CLI の出力は大量・高速で、TUI の部分再描画が支配的
- **`useTerminal.ts` の生成時と反映 effect の両方に入れる**: 生成時だけだと設定を変えても既存タブに効かず、反映 effect だけだと起動直後に効かない
- **`useTerminal.ts:73-178` の effect 依存配列 `[containerRef]` は触らない**（コメントで「意図的」と明記）。テーマと同じく、反映は別 effect（`:195-201`）で行う
- **`accessibility-support-changed` は macOS / Windows でのみ発火する**。発火しない環境では初期値だけが使われる（縮退しても壊れない）

---

## 4. 設計判断履歴

| 日付 | 判断 | 根拠 | 代替案 |
|---|---|---|---|
| 2026-07-29 | 設定（明示）と OS 検知（自動）の OR を実効値にする | 設定だけだと**その設定の存在を知らないユーザーには永久に届かない**。検知だけだと、支援技術を使わないが DOM 経由で読みたい人が有効にできない | どちらか一方だけ |
| 2026-07-29 | 検知は `app.accessibilitySupportEnabled` + `accessibility-support-changed` を使う | Electron が標準で持っている。自前で VoiceOver の起動を調べる手段は無い | 起動時に1回だけ見る（VoiceOver を後から起動した人に効かない） |
| 2026-07-29 | 設定パネルに「アクセシビリティ」節を新設する | 既存の「動作」節は tmux・絞り込み・ポーリング間隔が同居するゴミ箱になっており、そこへ足すと余計に読めなくなる（#20 の I-5 で指摘済み） | 「表示」節に入れる（表示はターミナル専用の節で、意味がずれる） |
| 2026-07-29 | E2E で**無効時と有効時の両方**を見る | 有効時だけ見ると「常に出ている」場合も緑になり、設定が効いていることを何も担保しない | 有効時だけ見る |
| 2026-07-29 | 読み上げの品質そのものは検証範囲外とする | OS の支援技術を起動しないと確認できない。また Claude Code の TUI 自体がスクリーンリーダーで実用にならないのは上流の問題で、このアプリでは解決できない | 読み上げ内容の作り込みまでやる（非目標） |
