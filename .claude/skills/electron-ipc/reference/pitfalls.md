# IPC / preload 周りの既知のハマりどころ

## preload が `.mjs` として出力される

`package.json` の `"type": "module"` により、electron-vite は preload のビルド成果物を `out/preload/index.mjs` として出力する（`.js` にはならない）。`src/main/index.ts` の `webPreferences.preload` を `.js` パスに書き換えると、アプリは起動するのに preload が一切ロードされない状態になる。

- 症状は `Unable to load preload script` というエラーで、preload が読み込めていないためウィンドウは表示されるが `window.api` が `undefined` になり、ターミナルや履歴一覧が何も動かない
- ESM 形式の preload は `webPreferences.sandbox: false` のときのみロード可能という Electron 側の制約があるため、「preload を `.mjs` にする」と「`sandbox: false` にする」は対の設定。どちらか片方だけ変えると壊れる（背景は [process-boundary.md](process-boundary.md) の3点セットの節を参照）

## このエラーはターミナル側に出ず DevTools のコンソールにしか出ない

`Unable to load preload script` は `make dev` を実行しているターミナルには出力されない。**DevTools を開いていないと気づけない。** 実装中もこれが原因で発見が遅れた実例がある。preload 経由の機能（`window.api.*` すべて）が軒並み動かない・何も反応しないときは、まず `Cmd+Option+I` で DevTools を開いてコンソールを確認する。

## Main プロセスの `console.log` は DevTools ではなくターミナル側に出る

Main プロセスはターミナルの `make dev` を実行している側の標準出力にログが出る。preload / Renderer の `console.log` は逆に DevTools のコンソールに出る。**ログの出力先を間違えると「ログが全く出ていない」と誤認する**（実際には反対側を見ている）。PTY の起動引数や `claude agents --json` のパース結果を Main 側で追いたいときは、`make dev-debug` でデバッガを繋ぐ方法もある。

## 破棄済みの WebContents に送らない

`ipcMain` 側から Renderer へ push する際（`webContents.send(...)`）、対象の `WebContents` がすでに破棄されていると例外になりうる。`src/main/pty/manager.ts` では PTY の出力転送・終了通知の両方で送信前に `entry.sender.isDestroyed()` を確認してから `send` している。新しく Main -> Renderer の push を追加するときは、同様に送信直前で破棄チェックを行う（ウィンドウを閉じた直後に PTY からの非同期コールバックが発火するタイミングで、実際にこのチェックが無いと落ちうる）。

## ⛔ 登録時のウィンドウを閉包で掴むと、作り直された瞬間に届かなくなる（実際に起きた）

Main -> Renderer の push を登録する関数が `win` を引数で受けて閉包に閉じ込めると、
**`app.on('activate')` で本体ウィンドウを作り直したあと、二度と届かなくなる。**

```ts
// ⛔ これ。win は最初のウィンドウのまま
export function registerXHandlers(win: BrowserWindow): void {
  app.on('some-event', () => {
    if (win.isDestroyed()) return;      // 以後ずっとここで return する
    win.webContents.send(...);
  });
}
```

**しかも張り直しでは直せない。** 同じ関数の中に `ipcMain.handle` があると、
呼び直した瞬間に**二重登録で throw** する。

**壊れ方が静か。** マウント時の `invoke` で初期値は取れるので、
症状は「**起動直後は正しいのに、Dock から復帰したあと変化に反応しなくなる**」という
気づきにくい形になる（`src/main/accessibility.ts` で実在した。Issue #149）。

**正しい形は2つ。どちらも既にリポジトリにある。**

| 形 | 前例 |
|---|---|
| **宛先をイベントのたびに解決する**（`BrowserWindow.getAllWindows()` を回す。破棄チェックは**ウィンドウごと**に） | `src/main/config.ts` の `broadcastConfig` |
| **getter を渡す**（`() => mainWindow`） | `registerSettingsWindowHandlers(() => mainWindow)` |

⚠ **`app.on('activate')` で張り直しているものが正しいとは限らない。**
現状そこにあるのは `registerApplicationMenu` **だけ**で、`index.ts` のコメント自身が
「忘れると再表示後に無反応になる」と警告している。**引数でウィンドウそのものを受けている
登録関数は、全部この形を疑う。**

## 配信先を1枚から全ウィンドウへ広げるのは Contract 変更ではない。ただし doc は直す

チャンネル名・payload の型・preload の露出面が変わらないなら、`src/shared/ipc.ts` の
**型は1文字も変わらない**（`/electron-ipc` の追加手順を通す必要も無い）。

⛔ **それでも doc コメントは直す。** `config.onChange` の doc は
「**Main が全ウィンドウへ配信する**」と配信範囲まで書いている。片方だけ範囲を書かないままにすると、
**単一の正のファイルが実装より弱い記述で残る**（読んだ人が「本体だけ」と誤解する）。

