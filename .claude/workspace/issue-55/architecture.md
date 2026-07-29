# Architecture

Issue #55 における変更対象の構造。
設計判断の根拠は末尾の「設計判断履歴」を参照。

---

## 1. 対象トラック

単一トラック（renderer 中心。preload に API を1本、main にウィンドウの既定挙動の抑止を1箇所）。

| コンポーネント | 変更内容 | 影響範囲 |
|---|---|---|
| `src/renderer/src/lib/dropPath.ts` | 追加（純粋関数） | unit test から直接呼ぶ |
| `src/renderer/src/terminal/TerminalPane.tsx` | 変更（drop ハンドラ） | ペイン単位。分割表示（#56）でもそのまま生きる |
| `src/preload/index.ts` | 変更（`app.pathForFile` の露出） | `webUtils` の import が増える |
| `src/shared/ipc.ts` | 変更（`RendererApi.app` に1メソッド） | preload / renderer の型 |
| `src/renderer/src/App.tsx` | 変更（window 全体の dragover/drop 抑止） | アプリ全体 |

---

## 2. Contract（src/shared/ipc.ts）変更

| チャンネル / 型 | 変更 | 内容 |
|---|---|---|
| `RendererApi.app.pathForFile` | ADD | `(file: File) => string`。**IPC チャンネルは増えない**（`webUtils` は preload で同期的に解決できる） |

`IpcInvoke` / `IpcSend` / `IpcEvent` に追加は無い。

---

## 3. 技術的制約・前提条件

- **`File.path` は Electron 32 で削除済み**（本アプリは Electron 43）。`webUtils.getPathForFile(file)` が唯一の代替で、
  これは **preload でしか呼べない**（`contextIsolation: true` を維持するため、Renderer に `webUtils` 自体は渡さない）。
- PTY へは `window.api.pty.input()` で書き込む。**PTY 出力は加工しないの鉄則は「出力」の話**で、
  入力の合成はアプリの責務として許される（既存の xterm `onData` と同じ経路）。
- Electron はウィンドウにファイルがドロップされると**そのファイルへ画面遷移する**（アプリが白画面になる）。
  ドロップを受ける要素の外側でも `dragover` / `drop` の `preventDefault()` が要る。
- ドロップの取得経路は2本用意する:
  1. `dataTransfer.files` -> `webUtils.getPathForFile()`（Finder からの本物のドラッグ）
  2. `dataTransfer.getData('text/uri-list')` の `file://` URI をデコード（他アプリ経由、および**E2E から合成できる唯一の経路**）

---

## 4. 設計判断履歴

| 日付 | 判断 | 根拠 | 代替案 |
|---|---|---|---|
| 2026-07-29 | エスケープはシングルクォート囲みではなくバックスラッシュ方式 | Terminal.app / iTerm2 / Ghostty がすべてバックスラッシュ方式で、**ドロップ後にユーザーが続けて文字を打てる**（クォートの中に閉じ込められない）。zsh / bash / fish のいずれでも同じ意味になる | `'...'` で囲む（パス中の `'` の扱いが shell 方言で割れる） |
| 2026-07-29 | 挿入先はアクティブペインではなくドロップされたペイン | 他ターミナルの挙動と一致し、分割表示（#56）でも自明に動く | 常にアクティブペインへ送る |
| 2026-07-29 | `text/uri-list` を第2経路として実装する | **`webUtils.getPathForFile()` は合成 `File` に対して空文字を返す**ため、これが無いと D&D は E2E で1本も検証できない。実装上も他アプリからの URI ドラッグに対応できて筋が良い | E2E を諦めて手動確認のみにする |
