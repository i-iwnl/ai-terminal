# Worklog

時系列の作業ログ。**設計判断の根拠**と**学んだ教訓**を中心に記録する。
コード差分は git log を参照、現状の構造は `architecture.md` を参照。

---

## 2026-07-29 - ワークスペース作成・設計

### 実施内容

- ユーザーの相談（dev 起動中の再起動でセッションが途切れる → 安定版を並走させたい）から Issue #27 を起票
- feat/application-menu に Issue #21/#22 の未コミット変更が大量にあるため、ユーザー確認の上で専用ワークツリー `.claude/worktrees/issue-27-stable-package/`（ブランチ worktree-issue-27-stable-package、origin/main 起点）で作業することにした
- `~/.ai-terminal` のハードコード箇所を棚卸し（config.ts / memo/store.ts / history/titles.ts の3箇所）
- E2E ハーネスの隔離方式を確認（HOME 差し替え + `--user-data-dir`。E2E は非パッケージ実行なので isPackaged 分岐だけでは壊れる → `AI_TERMINAL_DATA_DIR` 上書きを設計に追加）

### 設計判断

- architecture.md の設計判断履歴を参照（保存先の分岐基準・環境変数上書き・userData スイッチ判定・dmg target）

### 次に再開するとき最初に読むべきこと

- 作業場所は本体リポジトリではなく **ワークツリー** `.claude/worktrees/issue-27-stable-package/`。npm install / rebuild は実施済み
- 実装は未着手。overview.md の「直近の次アクション」P0（data-dir.ts 新設）から
- E2E ハーネス（e2e/fixtures/harness.ts）に `AI_TERMINAL_DATA_DIR` を足し忘れると全 E2E の設定フィクスチャが読まれなくなる点に注意

---

## 2026-07-29 - 実装・検証・文書化（1周で完了条件をすべて達成）

### 実施内容

- `src/main/data-dir.ts` を新設し、config / memo / titles の3箇所の `~/.ai-terminal` ハードコードを `dataDir()` に集約（規則: `AI_TERMINAL_DATA_DIR` > isPackaged ? `.ai-terminal` : `.ai-terminal-dev`）
- `src/main/index.ts` で非パッケージ実行時に userData へ `-dev` サフィックス（`--user-data-dir` スイッチがあるときは尊重）
- `test/stubs/electron.ts` に `app.isPackaged`（値のみ）を追加、`test/unit/data-dir.test.ts` を新規作成（4件）
- `e2e/fixtures/harness.ts` の env に `AI_TERMINAL_DATA_DIR` を1行追加（既存フィクスチャ・spec は無変更）
- electron-builder を導入（`electron-builder.yml` / `npm run package` / `make package`）。mac target は dmg、node-pty は asarUnpack
- 検証: `make check` 67件 green / `make e2e` 35 シナリオ green / `make e2e-lint` FAIL=0 / `make package` で dist/mac-arm64/ai-terminal.app + dmg 生成
- 実起動検証: パッケージ版を `open -g` で起動 → プロセス生存・`~/Library/Application Support/ai-terminal` と既存 `~/.ai-terminal` を使用・osascript で正常終了。非パッケージ起動（`npx electron .`）→ `Application Support/ai-terminal-dev` が作られ分離を確認
- 文書: README（安定版セクション + 保存先分離の説明）、ルート CLAUDE.md（`make package` 追記）

### 設計判断

- architecture.md の設計判断履歴を参照（新規追加なし。設計どおりに実装できた）

### 教訓（該当する場合）

- electron-builder は署名 identity が無いと `skipped macOS application code signing` と警告するが、成果物は `adhoc,linker-signed` になっており arm64 でも起動できる（`codesign -dv` で確認）。ローカル用途ならこの警告は無視してよい
- `~/.ai-terminal-dev` のファイル側ディレクトリは初回書き込みまで作られない（読み込みは無ければ既定値に縮退する設計のため）。分離の実起動確認は Chromium が即座に作る userData 側（`Application Support/ai-terminal-dev`）を見るのが確実
- `make e2e` と `make package` はどちらも `out/` を書き換えるため同時に走らせない

### 次に再開するとき最初に読むべきこと

- **完了条件はすべて達成済み**（overview.md 参照）
- ユーザー指示を受けてコミット（429e5f5）・push・**PR [#32](https://github.com/i-iwnl/ai-terminal/pull/32) 作成済み**（ブランチは feat/issue-27-stable-package にリネーム。Closes #27 付き）
- 残タスクは PR のレビュー・マージ（ユーザー判断）。アプリアイコン未設定は [#31](https://github.com/i-iwnl/ai-terminal/issues/31)

---

## 2026-07-29 - アプリアイコンの作成と反映（Issue #31）

### 実施内容

- SVG でアイコン候補3案を作成（A: プロンプト+緑カーソル / B: ターミナルウィンドウ+信号機 / C: プロンプト+AI スパーク）。Playwright の Chromium で 1024x1024 透過 PNG にレンダリングし、ユーザーが C 案を選定
- `build/icon.png` に配置（electron-builder が自動検出して icns へ変換。`electron-builder.yml` の変更は不要）。SVG 原本を `build/icon.svg` として同梱
- `make package` を再実行し、`default Electron icon is used` 警告の消失と、生成された `Contents/Resources/icon.icns`（sips で PNG 化して目視）を確認

### 設計判断

- macOS Big Sur 以降の作法（角丸スクワークル・約10%の余白・影を画像に焼き込む）に従った。squircle は 824x824 / rx=185、色はアプリのテーマ（#1e1e1e 系）に揃えた
- `/design-review` は起動しない: SKILL.md の起動条件（styles.css・画面文言・パネル構造・状態表現）のいずれにも該当しないため。代わりにユーザー本人に3案から選んでもらう確認ゲートを踏んだ

### 教訓（該当する場合）

- E2E は Electron 直起動のため Playwright の Chromium は未ダウンロードだった。SVG レンダリングに使うなら `npx playwright install chromium-headless-shell` が必要（約95MB）
- icns の中身の確認は `sips -s format png <icon.icns> --out check.png` が手軽

### 次に再開するとき最初に読むべきこと

- アイコンは PR #32 に積んで反映済み。残タスクは PR のレビュー・マージ（ユーザー判断）のみ
- アイコンを差し替えたいときは `build/icon.svg` を編集 → PNG 化して `build/icon.png` を上書き → `make package`
