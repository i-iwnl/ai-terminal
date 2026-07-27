---
name: terminal
description: xterm.js と node-pty まわりの実装・不具合対応で使う。「ターミナルが開かない」「PTY が起動しない」「posix_spawnp failed で落ちる」「日本語が入力できない・IME の変換中表示が崩れる」「日本語や絵文字で文字幅がずれる」「vim や htop の表示が崩れる」「コピペやショートカット（Cmd+T 等）が効かない」「tmux でラップしたセッションの終了が検知されない」といった依頼・不具合調査時に読む。xterm.js のアドオン構成（fit / webgl / unicode-graphemes / search / clipboard / web-links）、node-pty の起動・環境変数・シェル決定順、GUI 手動検証の手順を扱う。claude / gemini CLI 自体の起動引数やポーリングは /ai-cli、IPC 経由の追加・preload 境界は /electron-ipc を参照。
---

# terminal

普段使いのターミナルとして成立させるための、xterm.js（描画）と node-pty（PTY）まわりの知識と検証手順。

## どれを読むか

| やること | 読むドキュメント |
|---|---|
| PTY が起動しない・環境変数・tmux ラップのハマりどころを調べる | [reference/pty-pitfalls.md](reference/pty-pitfalls.md) |
| xterm.js のアドオン構成・キー入力の横取り方針を調べる | [reference/xterm-setup.md](reference/xterm-setup.md) |
| ターミナルとして実際に使えるかを人手で検証する | [operations/verify-terminal.md](operations/verify-terminal.md) |

## 絶対に守ること

- ⛔ `scripts/fix-node-pty.mjs` の `postinstall` 実行をやめない -> spawn-helper の実行権限が npm install のたびに落ち、`posix_spawnp failed` で PTY が一切起動しなくなる（詳細は [reference/pty-pitfalls.md](reference/pty-pitfalls.md)）
- ⛔ PTY 出力を自前で加工・整形しない -> 根拠と詳細はルート CLAUDE.md の「アーキテクチャの鉄則」を参照
- ⛔ 旧 `xterm` パッケージを使わない -> `@xterm/` スコープ付きのみを使う（根拠はルート CLAUDE.md 参照）

## 関連

- claude / gemini CLI の起動引数・ポーリング仕様 -> [/ai-cli](../ai-cli/SKILL.md)
- IPC チャンネルの追加・preload 境界 -> [/electron-ipc](../electron-ipc/SKILL.md)
- 検証コマンド（`npm run typecheck` 等）と Git 操作方針の唯一の正 -> ルート [CLAUDE.md](../../../CLAUDE.md)
