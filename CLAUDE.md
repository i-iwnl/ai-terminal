# ai-terminal

AI コーディングエージェント（Claude Code / Gemini CLI）を飼うことに最適化した、macOS 向けの自作ターミナルアプリ。

設計の全体像・調査結果・フェーズ計画は **`docs/PLAN.md` を正とする**。実装前に必ず読むこと。

## 技術スタック（確定済み・変更しない）

- Electron 43 + electron-vite + TypeScript
- Renderer: React
- ターミナル: `@xterm/xterm` 6.0 系（**旧 `xterm` パッケージは deprecated。使わない**）
- PTY: `node-pty` 1.1（Main プロセスのみ）

## アーキテクチャの鉄則

1. **Renderer は OS を直接触らない。** PTY 起動・ファイル読み込み・子プロセス実行はすべて Main プロセス側。`contextIsolation: true` / `nodeIntegration: false` を維持し、`preload` の `contextBridge` で必要な IPC だけを露出する。
2. **PTY の出力は加工しない。** ANSI エスケープを自前で解釈・整形せず、バイト列のまま Renderer に流して xterm.js に食わせる。CLI 側の新機能に勝手に追従できるのがこの設計の価値。
3. **IPC のチャンネル名と型は `src/shared/ipc.ts` を単一の正とする。** 文字列リテラルを各所に散らさない。型を変えるときはこのファイルを起点にする。
4. **外部コマンドの出力パースは1ファイルに閉じ込める。** `claude agents --json` は `src/main/agents/`、`~/.claude/projects/*.jsonl` は `src/main/history/` の中だけ。CLI 側の仕様変更で壊れたとき、直す場所が1箇所で済むようにする。
5. **外部フォーマットのパース失敗でアプリを落とさない。** Claude Code のセッション JSONL は公式に「内部フォーマットでバージョン間で変わりうる」と明記されている。パースは常に防御的に書き、失敗時は取得できた情報（sessionId・mtime）だけで縮退表示する。

## AI CLI との連携方針

- **API キーは使わない。** `claude` / `gemini` の CLI バイナリを `node-pty` で子プロセスとして起動し、対話モードのまま PTY 出力を転送する。
- Claude セッションを起動するときは `--session-id <uuid>` を渡し、アプリ側が採番した ID で追跡できるようにする。
- 実行中セッションの一覧は `claude agents --json` のポーリングで取得する。
- 再開は `claude --resume <sessionId>`。ここは公式サポート済みの安定インターフェース。

## コマンド（検証コマンドの唯一の正）

```bash
make dev           # 開発起動（DevTools が別ウィンドウで自動的に開く）
make dev-quiet     # DevTools を開かずに起動
make dev-debug     # Main プロセスのデバッガを有効にして起動
make check         # typecheck + lint（変更後は必ずこれを通す）
make build         # 本番ビルド
make docker-verify # typecheck + lint + build を Docker コンテナ内で実行
```

`make` を使わない場合は `npm run dev` / `npm run typecheck` / `npm run lint` / `npm run build`。
一覧は `make` で表示できる。**skill やドキュメントに検証コマンドを再掲しない。ここを参照する。**

## 作業分担の既定方針

**次のいずれかに該当したら、ユーザーの明示指示を待たずに `/orchestrator` を起動する。** メインは計画・レビュー・統合に専念し、実務はワーカーサブエージェントへ委譲する。

1. 3ファイル以上にまたがる修正・リファクタ
2. 独立した調査軸が2つ以上ある調査
3. 調査 -> 実装 -> 検証と工程が分かれるタスク
4. 同種の機械的修正が多数あるタスク

小さな単発タスクはメインが直接実行してよい。

**タスクに応じて以下の skill を自動で起動してよい**（`/` 付きでユーザーが明示的に呼ぶこともできる）。

| タスク | skill |
|---|---|
| IPC チャンネルの追加・変更、preload・contextBridge、Renderer から OS 情報を取る | `/electron-ipc` |
| claude / gemini CLI の起動引数、タスク一覧・履歴が出ない、CLI 更新でパースが壊れた | `/ai-cli` |
| PTY が起動しない、日本語 IME・文字幅、vim / htop の表示崩れ、ショートカット、tmux | `/terminal` |

skill 一覧と設計ルールの全体像は **[.claude/README.md](.claude/README.md)** を参照。
skill や agent の md を編集したら `bash .claude/scripts/lint-skills.sh` を通すこと。

## ドキュメントの地図

| 知りたいこと | ファイル |
|---|---|
| 設計の経緯・調査結果・フェーズ計画 | `docs/PLAN.md` |
| 起動方法・ショートカット・設定・トラブルシューティング | `README.md` |
| Docker 環境（ビルド検証 / devcontainer） | `docs/DOCKER.md` |
| AI エージェントの隔離実行と、その限界 | `docs/SANDBOX.md` |

## Git 操作

**commit / push / PR 作成は、ユーザーが明示的に指示したときのみ行う。** エージェントが自発的にコミットしてはいけない。

## コーディング規約

- TypeScript の `any` を使わない。外部 JSON のパースは `unknown` で受けて絞り込む。
- 日本語のコメント・UI 文言で構わない。
- 機種依存文字（丸数字など）を使わない。
