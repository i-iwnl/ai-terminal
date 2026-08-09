# ai-terminal

AI コーディングエージェント（Claude Code / Gemini CLI）を飼うことに最適化した、macOS 向けの自作ターミナルアプリ。

設計の全体像・調査結果・フェーズ計画は **`docs/PLAN.md` を正とする**。実装前に必ず読むこと。

## 応答の言語

**ユーザーへの返信は必ず日本語で書く。** 計画の提示・進捗報告・質問・完了報告・エラーの説明を含め、
ユーザーの目に触れる文章はすべて日本語にする（英語で聞かれた場合も日本語で返す）。

コード・識別子・コマンド・ログの引用はそのまま原文でよい。コメントと UI 文言の言語は
下の「コーディング規約」が正。

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
make check         # typecheck + lint + unit（変更後は必ずこれを通す）
make unit          # 単体テストのみ（vitest。純粋関数だけを対象にする）
make e2e           # E2E（Playwright + Electron。ウィンドウは表示しない）
make e2e-visible   # E2E をウィンドウを表示して実行する（挙動を目で追いたいときだけ）
make e2e-packaged  # パッケージ版 .app に対するスモーク E2E（package-dir から一括）
make e2e-screenshots-check # docs/images/ の中身が実装とずれていないかを画素で検査する（後述）
make css-substitution-check # CSS のトークン化で値が変わっていないことを証明する（後述）
make build         # 本番ビルド
make package       # 安定版の .app / dmg を dist/ に生成（ローカル用・署名は ad-hoc）
make install-app   # package まで一括で行い /Applications へ入れ替える（起動中は中止する。入れ替え前にパッケージ版スモークが関門として走る）
make docker-verify # typecheck + lint + build を Docker コンテナ内で実行
```

`make` を使わない場合は `npm run dev` / `npm run typecheck` / `npm run lint` / `npm run unit` / `npm run build`。
一覧は `make` で表示できる。**skill やドキュメントに検証コマンドを再掲しない。ここを参照する。**

**CSS のデザイントークンは「置換」と「値の変更」を同じ変更に混ぜない。** `src/renderer/src/styles.css` の `:root` が色・サイズ・余白の唯一の正で、本体に色のリテラルを直接書かない（単体テストが検出する）。トークンへ置換するだけの変更では `make css-substitution-check` が必ず通ること。**値を意図的に変えるときだけ落ちてよい**ので `make check` には含めていない。

**README の画像が古くなっていないかは `make e2e-screenshots-check` が画素で見る。** `make e2e`（または `make e2e-screenshots`）で撮った直後に回すと、`docs/images/` の中身が実装とずれていれば落ちる。**画面を意図的に変えたときだけ落ちてよい**ので `make e2e` には含めていない（`css-substitution-check` と同じ扱い）。落ちたら `make e2e-screenshots` で撮り直し、**変わった画像1枚ずつについて「この画面にこの変更が波及するはずがあるか」を言えるまでコミットしない**。

**検証の関門は2段。実装を1つ終えるたびに `make check` + 実機確認、push / PR の前にフル `make e2e`。** 実機確認は起動中のアプリに `agent-browser` を CDP でつないで見る（手順は `/e2e` の `operations/verify-on-device.md`）。**E2E も撮影レーンもホバー状態を作らないので、ホバー中の見た目・計算後のスタイル・再起動後の永続化はここでしか確認できない。** 逆に回帰（自分が触っていない場所が壊れたこと）は `make e2e` でしか出ない。**代替関係にない。**

**テストの置き場は「外部に触れるか」で決める。** 入力から出力が閉じた純粋関数は `test/unit/`（vitest）、画面・PTY・IPC を跨ぐ振る舞いは `e2e/specs/`（Playwright）。Electron を起動する必要があるなら後者。

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
| **機能追加・不具合修正を1周回す（計画 -> 実装 -> 検証 -> 文書 -> 記録）** | **`/workspace-plan loop`** |
| 作業を始める / 進捗を記録する / セッションが切れて再開する | `/workspace-plan` |
| IPC チャンネルの追加・変更、preload・contextBridge、Renderer から OS 情報を取る | `/electron-ipc` |
| claude / gemini CLI の起動引数、タスク一覧・履歴が出ない、CLI 更新でパースが壊れた | `/ai-cli` |
| PTY が起動しない、日本語 IME・文字幅、vim / htop の表示崩れ、ショートカット、tmux | `/terminal` |
| E2E テストを追加する / 落ちた / 不安定 / スクリーンショットを撮り直す | `/e2e` |
| UI の見た目・文言・配色・状態表現を変える（5ペルソナのレビューを差し込む） | `/design-review` |

**実装を伴う依頼は、既定で `/workspace-plan loop` を通す。** 計画の確認ゲートと、検証・文書更新・記録の停止条件がここに集約されている。1ファイルで完結する自明な修正だけは直接実行してよい。

skill 一覧と設計ルールの全体像は **[.claude/README.md](.claude/README.md)** を参照。
skill や agent の md を編集したら `bash .claude/scripts/lint-skills.sh` を通すこと。

## ドキュメントの地図

| 知りたいこと | ファイル |
|---|---|
| 設計の経緯・調査結果・フェーズ計画 | `docs/PLAN.md` |
| 起動方法・ショートカット・設定・トラブルシューティング | `README.md` |
| Docker 環境（ビルド検証 / devcontainer） | `docs/DOCKER.md` |
| AI エージェントの隔離実行と、その限界 | `docs/SANDBOX.md` |

## タスク管理とコンテキストの保持

**チケットは GitHub Issues が正。** リポジトリ内にチケットファイルは持たない。

| 内容 | 唯一の正 |
|---|---|
| 何を・なぜやるか、完了条件、作業の状態（open / closed） | GitHub Issue |
| どう作るか、設計判断、進捗の詳細、教訓 | `.claude/workspace/issue-<番号>/` |

**複数セッションにまたがる作業は、着手時に `/workspace-plan init <Issue番号>` でワークスペースを作る。** Issue 本文をコピーせず、リンクと要約に留めること（二重化の禁止）。

**⛔ 作業の途中で新規 Issue を立てない。** 周の中で見つけたものは `known-issues.md` に書くだけにし、切り出したくなったら**その Issue の周を1つ増やす**。GitHub Issue へ起こすのは `/workspace-plan promote-known-issues` を明示的に呼んだときだけで、**その手順自身が open 件数の上限（20件）で止まる**。放置すると「1つ潰すと5つ増える」ポンプになる（2026-08-04 に1日で 46 件作成 / 14 件 close の実績）。

**人力でしか進められないものは [#195](https://github.com/i-iwnl/ai-terminal/issues/195) に集約し、元 Issue を閉じる。** エージェントが原理的に完了できない項目（OS の支援技術・OS 通知・実 tmux・OS のシステム設定に依存する確認、および製品の意思決定）は、#195 の該当セクションに追記して**元の Issue を `not planned` で閉じる**。閉じるのは「解決したから」ではなく「エージェント側の作業が尽きたから」で、**残作業の唯一の正は #195 になる**。

- **エージェントは #195 を閉じない。** 全項目が消化されたときに人が閉じる
- ⛔ **書いてよいのは「エージェントには不可能なもの」だけ。** 面倒・重い・時間がかかるは理由にならない（それは周を分ける理由であって、人力に投げる理由ではない）
- 狙いは open 件数の意味を保つこと。**open な Issue が「エージェントが進められるもの」だけになる**ので、「残っている＝まだやることがある」が嘘にならない

作業のたびに `worklog.md` へ追記する。**各エントリの「次に再開するとき最初に読むべきこと」は省略しない。** セッションが切れても文脈を復元できることが、このディレクトリの存在理由。

再開時は `.claude/workspace/issue-<番号>/worklog.md` の最新エントリから読む。

## Git 操作

**commit / push / PR 作成は、ユーザーが明示的に指示したときのみ行う。** エージェントが自発的にコミットしてはいけない。

**push / PR の前に `make e2e` フルセットと `make e2e-lint` を通す。** UI・CSS・DOM 構造を触っていれば `make e2e-screenshots` も回す。**赤いまま push しない。** 落ちたら push を止めて報告する（この関門は CI ではなく人とエージェントが守る。CI は無い）。

**ただし `.claude/**` / `docs/**` / `README.md` / `CLAUDE.md` しか触っていないブランチは `make e2e` を省いてよい。** 判定は「関係なさそう」という主観ではなく、`git diff --name-only origin/main...HEAD` を上のパス集合と突き合わせて機械的に行う（コマンドと注意点は `/workspace-plan` の `operations/loop.md`）。**`make check` は省略しない**（`README.md` と `CLAUDE.md` は単体テストと lint が読んでいる）。

**スタック PR を作らない。** base 側を `gh pr merge --delete-branch` でマージすると、そこに積んだ子 PR は**自動クローズされ、しかも再オープンできない**（base ブランチが存在しない PR は `reopenPullRequest` が失敗する）。実際に1本失って立て直した。**すべて `main` から生やし、順にマージする。**

## コーディング規約

- TypeScript の `any` を使わない。外部 JSON のパースは `unknown` で受けて絞り込む。
- 日本語のコメント・UI 文言で構わない。
- 機種依存文字（丸数字など）を使わない。
