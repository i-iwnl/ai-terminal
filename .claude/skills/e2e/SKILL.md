---
name: e2e
description: Playwright を使った Electron E2E テスト（e2e/ 配下、全35シナリオ）の追加・実行・デバッグで使う。「E2E を追加したい」「テストが落ちた」「シナリオを増やしたい」「スクリーンショットを撮り直したい」「テストが不安定」「make e2e が失敗する」「隔離ハーネスの挙動を知りたい」といった依頼で読む。scenarios.yml を唯一の正とするシナリオ台帳、e2e/specs/ の spec ファイル、e2e/fixtures/harness.ts の隔離ハーネス（一時 HOME・偽 CLI・固定 JSONL フィクスチャ）、make e2e-lint による scenarios.yml と spec の1:1検査を扱う。ターミナル自体の描画・PTY の不具合調査は /terminal、claude / gemini CLI 出力のパースは /ai-cli、IPC 契約の変更は /electron-ipc を参照し、この skill では扱わない。
---

# e2e

Playwright + Electron による E2E テスト基盤（`e2e/`）の運用知識。シナリオの追加・実行・不具合調査で読む。

## どれを読むか

| やること | 読むドキュメント |
|---|---|
| シナリオを1本追加する | [operations/add-scenario.md](operations/add-scenario.md) |
| E2E を実行する・落ちたテストを調べる | [operations/run-e2e.md](operations/run-e2e.md) |
| 隔離ハーネスの仕組み・ハマりどころを知る | [reference/isolation-harness.md](reference/isolation-harness.md) |
| 自動テストで担保できないものを知る | [reference/limitations.md](reference/limitations.md) |

## 絶対に守ること

- ⛔ `e2e/scenarios.yml` と `e2e/specs/` を1:1からズラさない -> `make e2e-lint` が機械検査する唯一の対象。ズレると検査そのものが意味を失う
- ⛔ 1 spec に `test()` を複数書かない（1 spec = 1 シナリオ）-> lint の check7 が検知して FAIL になる
- ⛔ アプリ本体のコードをテストのために変更しない -> 隔離は `e2e/fixtures/harness.ts` の環境変数差し替えだけで完結させる設計（詳細は [reference/isolation-harness.md](reference/isolation-harness.md)）
- ⛔ 実データのスキーマを推測でフィクスチャに書かない -> 過去に `aiTitle` を `title` と取り違えた前例あり（詳細は [reference/isolation-harness.md](reference/isolation-harness.md)）

## 関連

- ターミナルの描画・PTY 自体の不具合 -> [/terminal](../terminal/SKILL.md)
- claude / gemini CLI の出力パース -> [/ai-cli](../ai-cli/SKILL.md)
- IPC チャンネルの追加・preload 境界 -> [/electron-ipc](../electron-ipc/SKILL.md)
- 検証コマンド（`make check` 等）と Git 操作方針の唯一の正 -> ルート [CLAUDE.md](../../../CLAUDE.md)
