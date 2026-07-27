---
name: electron-ipc
description: Main / preload / Renderer 間の責務境界と IPC チャンネルの追加・変更を扱う。「IPC チャンネルを追加したい」「preload を触りたい」「Renderer から OS の情報（cwd・ホームディレクトリなど）を取りたい」「contextBridge に API を足したい」「ipcMain.handle / ipcRenderer.invoke を書きたい」「preload が読み込まれない」「DevTools に何も出ない」といった依頼・不具合対応時に使う。PTY 自体のライフサイクル管理は /terminal、claude / gemini CLI の起動引数やポーリングは /ai-cli を参照。
---

# electron-ipc

Electron の3プロセス（Main / preload / Renderer）間で IPC を追加・変更するときの手順と、責務境界の知識。

## どれを読むか

| やること | 読むドキュメント |
|---|---|
| IPC チャンネルを1本追加・変更する | [operations/add-ipc-channel.md](operations/add-ipc-channel.md) |
| Main / preload / Renderer の役割分担、なぜ Renderer が OS を触れないかを知りたい | [reference/process-boundary.md](reference/process-boundary.md) |
| preload が読み込まれない・DevTools に何も出ないなど既知のハマりどころを調べる | [reference/pitfalls.md](reference/pitfalls.md) |

## 非推奨 / 絶対に守ること

- IPC のチャンネル名を文字列リテラルで直接書かない -> `src/shared/ipc.ts` の `IpcInvoke` / `IpcSend` / `IpcEvent` 定数を使う（チャンネル名がタイプミスで各所にバラけると、CLI 側の変更時に直す場所を追えなくなる）
- preload のパスを `.js` に書き換えない -> `../preload/index.mjs` のまま（拡張子を変えると `Unable to load preload script` で起動だけして何も動かない。原因は [reference/pitfalls.md](reference/pitfalls.md) 参照）
- Renderer から Node API（`fs` / `child_process` 等）を import しない -> 必要な情報は Main にハンドラを足して IPC 経由で取得する（`contextIsolation: true` の前提が崩れる）

## 関連

- IPC 契約の唯一の正は `src/shared/ipc.ts`（このファイル自体は本 skill が管理するドキュメントではなく実装コード）
- PTY のライフサイクル・tmux ラップは [/terminal](../terminal/SKILL.md)
- claude / gemini CLI の起動引数・ポーリング仕様は [/ai-cli](../ai-cli/SKILL.md)
- 検証コマンド（`npm run typecheck` 等）の唯一の正 -> ルート [CLAUDE.md](../../../CLAUDE.md)
