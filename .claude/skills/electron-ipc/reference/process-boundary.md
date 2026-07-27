# Main / preload / Renderer の責務境界

## 3プロセスの役割

| プロセス | 実行環境 | やってよいこと | やってはいけないこと |
|---|---|---|---|
| Main | Node.js | PTY 起動、ファイル読み込み、子プロセス実行、OS 通知 | Renderer の DOM を直接触る |
| preload | Node.js + `contextBridge`（Renderer と同じウィンドウにロードされる） | `contextBridge.exposeInMainWorld` で `window.api` を組み立てる | ビジネスロジックを持つ（薄い橋渡しに徹する） |
| Renderer | Chromium（Web ページと同じサンドボックス） | `window.api` 経由で Main の機能を呼ぶ | Node API（`fs` / `child_process` / `os` 等）を直接 import する |

Renderer が OS を直接触らないのは、Chromium が任意の Web コンテンツを描画する層だから。ここに Node API をそのまま渡すと、表示しているコンテンツ（xterm.js の出力や将来的な外部リンク経由の内容）から任意のファイル読み書き・プロセス起動ができてしまう。PTY 起動・ファイル読み込み・子プロセス実行を Main に閉じ込めているのはこのため。

## `contextIsolation: true` / `nodeIntegration: false` / `sandbox: false` の組み合わせ

`src/main/index.ts` の `webPreferences` はこの3点セット。

- `contextIsolation: true` — preload の JS コンテキストと Renderer（Web ページ）の JS コンテキストを分離する。これが無いと、Web ページ側のスクリプトが preload のスコープに直接アクセスでき、`contextBridge` で絞り込んだ意味が無くなる
- `nodeIntegration: false` — Renderer に Node のグローバル（`require` 等）を注入しない。Renderer が Node API に触れない、という鉄則そのものを担保している設定
- `sandbox: false` — preload が Node API（`contextBridge` の裏で使う機構含む）を使うために必要。preload は electron-vite のビルドで ESM（`.mjs`）として出力されており、**ESM 形式の preload は `sandbox: false` のときのみロードできる**という Electron 側の制約があるため、この設定は preload の出力形式と対になっている（詳細は [pitfalls.md](pitfalls.md)）

3つのうちどれか1つでも組み合わせを崩すと、「preload は動くが contextBridge が機能しない」「preload自体がロードされない」といった壊れ方をする。変更したくなったら、まずこの3点セットを一緒に見直す。

## Renderer は cwd を解決できない

Renderer は Node API に触れないため、`process.cwd()` も `os.homedir()` も呼べない。実装中、履歴一覧の探索キー（`~/.claude/projects` の照合に使う cwd）や PTY 起動時の作業ディレクトリの既定値として「アプリを起動したディレクトリ」が必要になったが、Renderer 側だけでは取得手段が無いという設計上の穴に実際に当たった。

解決策として `app.paths()`（`IpcInvoke.appPaths`）を追加し、Main 側の `process.cwd()` / `homedir()` を IPC 経由で Renderer に供給している。実装は `src/main/app-paths.ts`。**「Renderer で欲しい OS 由来の値」が出てきたら、都度この IPC を経由するハンドラを足す**という以外の解決策は無い（Node API を直接触らせない鉄則を破らない限り）。

## チャンネル名を `src/shared/ipc.ts` の定数に一本化する理由

`IpcInvoke` / `IpcSend` / `IpcEvent` の文字列リテラルを Main / preload / Renderer の各所に直書きすると、以下が起きる。

- チャンネル名をタイプミスしても、Main と Renderer で別々の文字列を書いていれば型チェックでは検出できず、実行時に「ハンドラが呼ばれない」という気づきにくい形で壊れる
- チャンネル名を変更したいとき、`grep` で全箇所を探して直す羽目になる

`src/shared/ipc.ts` を唯一の正として import することで、名前の変更はこのファイルの1箇所で完結し、参照側は TypeScript の型エラーとして壊れた箇所を機械的に検出できる。
