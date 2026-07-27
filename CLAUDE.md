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

## コマンド

```bash
npm run dev        # 開発起動
npm run build      # ビルド
npm run typecheck  # 型チェック
npm run lint       # ESLint
```

## Git 操作

**commit / push / PR 作成は、ユーザーが明示的に指示したときのみ行う。** エージェントが自発的にコミットしてはいけない。

## コーディング規約

- TypeScript の `any` を使わない。外部 JSON のパースは `unknown` で受けて絞り込む。
- 日本語のコメント・UI 文言で構わない。
- 機種依存文字（丸数字など）を使わない。
