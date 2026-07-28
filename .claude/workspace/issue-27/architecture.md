# Architecture

Issue #27 における変更対象の構造。
設計判断の根拠は末尾の「設計判断履歴」を参照。

---

## 1. 対象トラック

単一トラック（Main プロセス + ビルド設定。Renderer / preload は触らない）。

| コンポーネント | 変更内容 | 影響範囲 |
|---|---|---|
| `src/main/data-dir.ts` | 新設。データ保存先ディレクトリの決定（純粋関数 + accessor） | config / memo / titles |
| `src/main/config.ts` | `CONFIG_DIR` を `dataDir()` に差し替え | 設定の読み書き先 |
| `src/main/memo/store.ts` | `MEMO_DIR` を `dataDir()` に差し替え | メモの読み書き先 |
| `src/main/history/titles.ts` | `TITLES_DIR` を `dataDir()` に差し替え | セッション表示名の読み書き先 |
| `src/main/index.ts` | 非パッケージ実行時に userData へ `-dev` サフィックス | localStorage / キャッシュの分離 |
| `test/stubs/electron.ts` | `app.isPackaged` を追加（値のみ） | unit テストの import 経路 |
| `e2e/fixtures/harness.ts` | `AI_TERMINAL_DATA_DIR` を一時 HOME の `.ai-terminal` に固定 | 全 E2E |
| `electron-builder.yml` / `package.json` / `Makefile` | パッケージング導入（`make package`） | ビルド成果物 `dist/` |

---

## 2. Contract（src/shared/ipc.ts）変更

なし。

---

## 3. 技術的制約・前提条件

- Renderer は OS を直接触らない（保存先の決定はすべて Main 側。ルート CLAUDE.md の鉄則 1）。
- E2E ハーネスは「アプリ本体のコードを変更せず HOME / PATH / 環境変数で隔離する」方針。保存先の分離もこの方針の範囲（環境変数1つ）で吸収する。
- E2E は `out/` のビルド成果物を electron バイナリ経由で起動するため `app.isPackaged` は常に false。isPackaged だけで分岐すると E2E の保存先前提（一時 HOME の `.ai-terminal`）が壊れる → 環境変数上書きが必須。
- macOS arm64 は署名なしバイナリを起動できない。electron-builder の既定（identity 未指定 → ad-hoc 署名へフォールバック）に任せ、`identity: null` を明示しない。

---

## 4. 設計判断履歴

| 日付 | 判断 | 根拠 | 代替案 |
|---|---|---|---|
| 2026-07-29 | 保存先の既定は `app.isPackaged` で分岐（packaged=`~/.ai-terminal`, それ以外=`~/.ai-terminal-dev`） | 安定版が既存データを引き継ぎ、dev 側が新規になる向きが安全（dev は壊れてよい） | dev 側を既存のままにする案は、安定版常用への移行時にデータが引き継がれず不便 |
| 2026-07-29 | 環境変数 `AI_TERMINAL_DATA_DIR` で保存先を絶対指定で上書き可能にする | E2E（非パッケージ実行）が既存フィクスチャを変えずに1行で固定できる | ハーネス・spec 側の `.ai-terminal` 参照を全部 `-dev` に書き換える案は変更箇所が散る |
| 2026-07-29 | userData の `-dev` サフィックスは `--user-data-dir` スイッチが無いときだけ適用 | E2E がテストごとの一時 userData を `--user-data-dir` で指定しており、上書きすると隔離が壊れる | 無条件で setPath する案 |
| 2026-07-29 | mac の target は `dmg`（`dist/mac-arm64/` に .app も残る） | /Applications へのインストール手段として標準的。dir だけでも .app は使えるが配布形が無い | `dir` のみ（ビルドは速いが配布形が無い） |
