# .claude

Claude Code の設定・skill を管理するディレクトリ。

## ディレクトリ構成

```
.claude/
├── skills/         ← skill 本体（インデックス型・メイン用の手順/知識）
├── agents/         ← サブエージェント定義（Agent ツールで隔離実行する単位）
├── scripts/        ← リポジトリ横断のハーネス（lint-skills.sh）
├── workspace/      ← 作業ごとの外部記憶（issue-<番号>/ 単位。/workspace-plan が管理）
└── README.md       ← このファイル
```

**チケット管理は GitHub Issues が正。** リポジトリ内チケット（`.claude/tickets/`）は持たない。
ワークスペースは Issue 番号をキーにして Issue と 1:1 に対応する（`.claude/workspace/issue-1/`）。

※ agents と skills の役割の違いは [設計ルール 5](#5-agents-と-skills-の使い分け) を参照。

---

## Skill 一覧

各 skill の**詳細ルーティングは SKILL.md を参照**。SKILL.md がインデックスとして機能し、`operations/` `reference/` 配下のファイルへの導線を持つ。

| skill | description |
|-------|-------------|
| [/electron-ipc](skills/electron-ipc/SKILL.md) | Main / preload / Renderer 間の責務境界と IPC チャンネルの追加・変更。contextBridge、`ipcMain.handle` / `ipcRenderer.invoke`、preload が読み込まれないときの調査 |
| [/ai-cli](skills/ai-cli/SKILL.md) | claude / gemini CLI の起動と出力パース。`claude agents --json`、`~/.claude/projects` の JSONL、`--session-id` / `--resume`、CLI 更新でパースが壊れたときの修復 |
| [/terminal](skills/terminal/SKILL.md) | xterm.js と node-pty まわり。PTY が起動しない、日本語 IME、文字幅のずれ、vim / htop の表示崩れ、tmux ラップ時の終了検知、GUI 手動検証の手順 |
| [/workspace-plan](skills/workspace-plan/SKILL.md) | 作業コンテキストの保持。`.claude/workspace/issue-<番号>/` の作成（init）、進捗の追記と Issue への同期（update）、一覧と Issue の突合（status） |

3本は責務が隣接しているため、SKILL.md の末尾で相互に境界をリンクしている。**どれを読むか迷ったら**「プロセス間の配線」なら `/electron-ipc`、「外部 CLI の出力」なら `/ai-cli`、「画面と子プロセス」なら `/terminal`。

> **単発タスク**（横断リファクタ・並列調査・複数ファイルの機械的修正）の指揮は `/orchestrator` が担う。これはリポジトリ内ではなく**個人スキル**（`~/.claude/skills/orchestrator`）として全リポジトリ共通で入れる運用。自動起動の条件はルート CLAUDE.md「作業分担の既定方針」が正。

---

## 設計ルール（skill / CLAUDE.md 維持時に従う）

### 1. CLAUDE.md と skill の使い分け

| 種類 | ロード | 用途 |
|------|--------|------|
| **CLAUDE.md** (ROOT) | 常時 | 全タスクで意識すべき事実・規約 |
| **CLAUDE.md** (ネスト) | そのディレクトリ作業時 | そのディレクトリ作業中ずっと必要な context（レイヤー責務等） |
| **SKILL.md** | description マッチ時 | skill のインデックス（ルーティング表） |
| **operations/** | SKILL.md からルーティング | タスクの**手順** |
| **reference/** | SKILL.md からルーティング | タスクで参照する**知識・規約** |
| **examples/** | SKILL.md からルーティング | **実装例**（コードサンプル） |

**判断基準（質問形式）:**
> 「このルールを**知らない状態でコードを書かれたら困るか？**」
> - 困る → CLAUDE.md（常時ロード必須）
> - 困らない（タスク発生時に取りに行けば OK）→ skill

### 2. インデックス型 skill の構造

```
{skill-name}/
├── SKILL.md          ← インデックスに徹する（30〜50行）
├── operations/       ← 手順（何をするか）
├── reference/        ← 知識・規約（何を知っているべきか）
├── examples/         ← 実装例・サンプルコード（任意、コードで見せる）
└── scripts/          ← 実行スクリプト（任意）
```

- **SKILL.md はルーティング表**に徹する。手順詳細は書かない（30〜50行が目安、最大100行）
- **SKILL.md には frontmatter（`name` / `description`）が必須**。無いと description が空になり、**その skill は自動ルーティングされなくなる**（`lint-skills.sh` が検査）
- **description** は skill 全体の入口で、サブ操作のキーワードを過不足なく並べる（自動ルーティングの精度を決める）
- **operations / reference の各ファイルには H1 を付ける**（単体で開いたときに何のファイルか分かるように）
- 規約や説明は `reference/`、**完結したコード例**は `examples/` に置く
- skill 配下に置けるのは **SKILL.md / operations/ / reference/ / examples/ / scripts/ のみ**。第6のカテゴリを作らない

### 3. ファイルサイズ目安

| 種類 | 推奨 | 上限 |
|------|------|------|
| ROOT CLAUDE.md | 〜200行 | 250行 |
| ネスト CLAUDE.md | 50〜200行 | 250行 |
| SKILL.md | 30〜50行 | 100行 |
| operations / reference 個別ファイル | 〜200行 | 300行（例外的に500行まで許容） |

**500行を超えたら必ず分割**。200〜300行は1サブトピックで凝集していれば許容。

### 4. 分割・統合の指針

- **H2 (`## `) 境界**で分割するのが基本
- 自然な凝集を尊重し、無理に細切れにしない（文脈分散はマイナス）
- 分割時は**完全性を機械検証する**（分割後の連結が元と一致するか。例: md5 の突合）
- 分割したら **SKILL.md のインデックスを必ず更新**（ルーティング切れ防止）

#### 章番号での「機械分割」は禁止

長い1本のドキュメントを章番号（`## 2.` `## 3.` など）で機械的に切り出す分割は**禁止**。実害の前例:

- **コードフェンスの途中で切れて Markdown が破損**（前ファイル末尾に閉じないフェンスが残り、次ファイルの見出しを巻き込む）
- 各ファイルが H1 を持たず `## 8.` からいきなり始まり、**単体で開くと何のファイルか分からない**
- 実質10行未満の、**参照コストに見合わない断片**が量産される

**分割は「単体で読んで意味が通る単位」でのみ行う。** 分割後は必ず各ファイルに H1 を付け、章番号は1から振り直す。分割の結果1ファイルが50行を切るなら、それは分割すべきでなかったサイン。

#### 統合時の DoD

- **旧ファイル間の記述矛盾を読み合わせる**（完全性検証は「欠落」しか防げず、「矛盾の持ち込み」を防げない）。統合は、断片間の矛盾を検出できる**唯一のタイミング**。
- 統合後のファイルが**通しで論理的に読めるか**を必ず通読して確認する。

### 5. agents と skills の使い分け

`.claude/agents/*.md` は**サブエージェント（`Agent` ツールで `subagent_type` を指定して起動される独立実行単位）の定義**で、skill とは役割が異なる。

| | `agents/*.md` | `skills/*` |
|---|---|---|
| 読み手 | **そのサブエージェント自身**（メインと分離された隔離コンテキストで単独起動） | **メインセッション（指揮者）** |
| 性質 | frontmatter（`name`/`description`/`model`/`tools`）を持つ**実行可能な定義** | `description` で自動ルーティングされる**手順・知識のインデックス** |
| 書く内容 | 役割・入力・**自分が叩く具体コマンド**・出力フォーマット・**自己検証チェックリスト**（自己完結） | いつどの agent を呼ぶか・ループ制御・メイン自身がやること・確認ゲート |
| モデル | **frontmatter `model:` が唯一の正** | 書かない（agent 定義を参照） |
| 手順詳細 | ここに書く | agent を**参照するだけ**（コピーはドリフトの温床） |

**判断フロー:**
> 「この内容は、サブエージェントが**自分のコンテキストだけで実行する**ために必要か？」
> - YES → `agents/<name>.md`
> - NO（メインがオーケストレーションとして知るべき／いつ呼ぶかの話）→ skill の `operations/` or `SKILL.md`

このリポジトリではまだサブエージェントを定義していない（`agents/` は空）。実装・レビューを役割分担させたくなったら追加し、この節に一覧表を足す。

### 6. 自動ロードの仕組み（運用上の留意）

- **skill description は常時ロード**されるので、各 skill の description にキーワードを過不足なく書く
- skill 本体（SKILL.md）は **description マッチで Claude が判断して呼ぶ**（自動）
- 確実に呼ばせたい時は `/skill-name` でユーザーが明示的に呼ぶ
- 「ファイル類似度」では skill は呼ばれない（ユーザー意図 × description のマッチング）

### 7. 重複の禁止（single source of truth）

同じルールを複数箇所に書かない（CLAUDE.md と skill、reference 同士で重複しないか確認）。すべての事実に「唯一の正」を決め、他は参照だけにする。
例外:「always-loaded reminder」として CLAUDE.md にも記述する場合は、それが**意図的なリマインダーであることを明記**する。

このリポジトリでの唯一の正:

| 事実 | 唯一の正 |
|---|---|
| アーキテクチャの鉄則・AI CLI 連携方針・コーディング規約 | ルート `CLAUDE.md` |
| 検証コマンド（typecheck / lint / build） | ルート `CLAUDE.md`（実体は `Makefile` と `package.json`） |
| IPC のチャンネル名と型 | `src/shared/ipc.ts`（実装コード） |
| 設計の経緯・調査結果・フェーズ計画 | `docs/PLAN.md` |
| Docker 環境の使い方 | `docs/DOCKER.md` と `docs/SANDBOX.md` |
| 起動方法・トラブルシューティング | ルート `README.md` |
| 何を・なぜやるか、作業の状態（open / closed） | **GitHub Issue** |
| どう作るか・設計判断・進捗の詳細・教訓 | `.claude/workspace/issue-<番号>/` |

### 8. メンテナンスハーネス

skill / agent の md を編集したら必ず実行:

```bash
bash .claude/scripts/lint-skills.sh
```

frontmatter の欠落・サイズ超過・リンク切れ・カテゴリ違反・この README の一覧と実体のズレ・ルート CLAUDE.md の健全性を検査する。
**ルールを増やすより、ルールをチェックに落とすことを優先する。** チェックに落とせない規約は守られないものとして扱う。

---

## 将来候補（skill 未整備の領域）

以下は skill 候補だが、元ネタがまだ無い、または既存ドキュメントと重複するため未整備。**同じ知識を2回以上取りに行った / ふりかえりの反映先が無い教訓が出た / CLAUDE.md が肥大化した** のいずれかが起きたら起こす。

| 候補 | 分類 | 起こすトリガーの見込み |
|---|---|---|
| docker | ツール/環境 | 現状は `docs/DOCKER.md` と `docs/SANDBOX.md` で足りており、skill 化すると重複になる。CI の設定が複雑化する、サンドボックスの運用手順が増える、コンテナ固有の罠が2件以上たまったら起こす |
| git | ワークフロー | 現状はルート CLAUDE.md の「ユーザーの明示指示時のみ」で足りる。PR テンプレート・ブランチ運用・レビュー手順が定型化したら起こす |
| release | ワークフロー | 配布を始めたときに起こす。electron-builder の設定、コード署名、公証（notarization）、自動更新はいずれも罠が多く、一度通すと必ず知識がたまる |
| ui | アプリ/レイヤー固有 | Renderer の React 側が育ってきたら。現状はタブとサイドバーだけで、コードを読めば分かる範囲を超えていない |
