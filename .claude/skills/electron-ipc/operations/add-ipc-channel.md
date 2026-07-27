# IPC チャンネルを1本追加・変更する

Main <-> Renderer の間に新しいやり取りを1本通す手順。実例として `app.paths()`（Renderer が Node API に触れないため、アプリ起動時の cwd とホームディレクトリを Main から供給する機能）の追加を通しで示す。この機能は実際にこの手順で追加された。

## 事前確認: invoke か send か

- **戻り値が要る / 高頻度でない** -> `IpcInvoke`（Renderer は `ipcRenderer.invoke`、Main は `ipcMain.handle`）。今回の `app.paths()` はこちら
- **戻り値不要 / 高頻度な一方向通信**（キー入力、リサイズ通知など）-> `IpcSend`（Renderer は `ipcRenderer.send`、Main は `ipcMain.on`）。`pty:input` / `pty:resize` が実例
- Main -> Renderer の push（PTY 出力、タスク一覧の更新通知など）は `IpcEvent`。今回の手順の対象外（既存の `subscribe` ヘルパーを使う）

## ステップ 1: `src/shared/ipc.ts` に型とチャンネル定数を足す

- リクエスト / レスポンスの型を定義する（例: `AppPaths` インターフェース）
- `IpcInvoke`（または `IpcSend`）にチャンネル定数を1行足す（例: `appPaths: 'app:paths'`）
- `RendererApi` インターフェースに、Renderer から見える関数シグネチャを足す（例: `app: { paths(): Promise<AppPaths> }`）

**終了条件**: このファイル単体で型チェックが通る（他ファイルはまだ未対応でエラーが出ていてよい）。

## ステップ 2: Main にハンドラを実装し `src/main/index.ts` で登録する

- `src/main/` 配下に実装ファイルを置く（例: `src/main/app-paths.ts`）。既存の1機能1ファイルの慣習に合わせる
- `ipcMain.handle(IpcInvoke.<チャンネル定数>, ...)`（invoke の場合）または `ipcMain.on(IpcSend.<チャンネル定数>, ...)`（send の場合）でハンドラを実装する
- 登録関数（例: `registerAppPathHandlers()`）を export し、`src/main/index.ts` の `app.whenReady().then(...)` 内で他のハンドラ登録と並べて呼び出す

**終了条件**: `src/main/index.ts` に新しい登録関数の呼び出しが追加されている。

## ステップ 3: preload の `RendererApi` 実装に足す

- `src/preload/index.ts` の `api` オブジェクトに、ステップ1で `RendererApi` に足した関数を実装する
- invoke なら `ipcRenderer.invoke(IpcInvoke.<チャンネル定数>, ...)` を返すだけ
- push イベントを購読する関数を足す場合は、既存の `subscribe()` ヘルパーを再利用する（新規に `ipcRenderer.on` を書かない）

**終了条件**: `src/preload/index.ts` が `RendererApi` を過不足なく満たし、preload 単体の型チェックが通る。

## ステップ 4: Renderer から使う

- Renderer 側のコードから `window.api.<ネームスペース>.<関数>()` の形で呼び出す（`app.paths()` の例なら `window.api.app.paths()`）
- Renderer は `RendererApi` 型だけを見て実装する。IPC チャンネル名や `ipcRenderer` を Renderer 側で直接扱わない

**終了条件**: 対象の Renderer コンポーネントが `window.api` 経由で新機能を呼び出せている。

## DoD（完了条件）

- `npm run typecheck` と `npm run lint` が通る（コマンドの唯一の正はルート [CLAUDE.md](../../../../CLAUDE.md)）
- 4ステップすべてが完了するまで「IPC を1本追加した」扱いにしない。型だけ足して Main 側の実装を忘れる、あるいは preload に反映し忘れると `window.api` 経由の呼び出しが実行時エラーになる
