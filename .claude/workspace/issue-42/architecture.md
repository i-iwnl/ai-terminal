# Architecture

Issue #42 における変更対象の構造。
設計判断の根拠は末尾の「設計判断履歴」を参照。

---

## 1. 対象トラック

単一トラック（e2e / Makefile / 文書のみ。src/ のアプリ本体は変更しない）

| コンポーネント | 変更内容 | 影響範囲 |
|---|---|---|
| e2e/fixtures/harness.ts | (1) 偽 CLI を rc 経由でのみ露出するオプション追加、(2) `executablePath`（パッケージ版バイナリ）対応 | 全 spec の起動経路 |
| e2e/scenarios.yml + e2e/specs/S39-*.spec.ts | 再発防止シナリオ追加 | - |
| e2e/packaged.playwright.config.ts（新設） | パッケージ版スモークの実行対象を絞る | - |
| Makefile | `package-dir` / `e2e-packaged` 追加、`install-app` の関門化 | 出荷フロー |
| .claude/skills/e2e/ | limitations.md 等の追記 | - |

---

## 2. Contract（src/shared/ipc.ts）変更

なし

---

## 3. 技術的制約・前提条件

- 隔離はハーネスの環境変数差し替えだけで完結させ、アプリ本体をテストのために変更しない（e2e skill の鉄則）
- scenarios.yml と specs の 1:1 を維持（make e2e-lint FAIL=0）
- パッケージ版スモークでも一時 HOME / AI_TERMINAL_DATA_DIR / --user-data-dir の隔離を維持する
- PR #41 の shell-path 実装に依存（ブランチはその上に積む）

---

## 4. 設計判断履歴

| 日付 | 判断 | 根拠 | 代替案 |
|---|---|---|---|
| 2026-07-29 | 全シナリオをパッケージ版へ移さず、スモーク数本だけの2レーン構成 | 1起動≒1秒の高速レーンの価値を守る。パッケージ差分の検出力はスモークでほぼ得られる | 全部パッケージ版（起動コスト増の割に上積みが小さく却下） |
| 2026-07-29 | スモークは `make install-app` の関門として実行（独立コマンドのみにしない） | 手で叩くレーンは形骸化する。「出荷する成果物を出荷する瞬間に検証」が原則 | make e2e-packaged を任意実行のみ（却下） |
