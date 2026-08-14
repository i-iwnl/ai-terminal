# Architecture

Issue #253 における変更対象の構造。
設計判断の根拠は末尾の「設計判断履歴」を参照。

---

## 1. 対象トラック

単一トラック（`src/main/` のみ。Renderer は触らない）。

| コンポーネント | 変更内容 | 影響範囲 |
|---|---|---|
| `src/main/inherited-agent-env.ts` | 新規追加 | 純粋関数 + `process.env` からの除去 |
| `src/main/index.ts` | 追加（1行の呼び出し） | `ensureLoginShellPath()` より前に置く |
| `test/unit/inherited-agent-env.test.ts` | 新規追加 | - |
| `e2e/fixtures/harness.ts` | `LaunchOptions` に注入フラグを追加 | 既定 off なので既存シナリオに影響しない |
| `e2e/specs/S<番号>-inherited-agent-env.spec.ts` | 新規追加 | `scenarios.yml` にも1行 |

---

## 2. Contract（src/shared/ipc.ts）変更

なし。

---

## 3. 技術的制約・前提条件

- ルート CLAUDE.md の鉄則1（Renderer は OS を直接触らない）: env の扱いは Main に閉じる。
- **除去は `process.env` の側で1回だけ行う。** `buildPtyEnv` の中で消すと、
  Dock から起動した（＝ base に無い）ケースで `mergeUserEnv` が rc から埋めた
  利用者の設定まで消してしまう。
- **`ensureLoginShellPath()` より前に実行する。** 探索シェル（`$SHELL -i -l -c`）は
  Main の `process.env` を継承するので、先に消しておかないと探索シェルが同じ値を
  再エクスポートし、`mergeUserEnv` が埋め戻してしまう。
  `src/main/index.ts` は**モジュール読み込み時（33行目）に探索を開始している**ので、
  呼び出しは import 直後に置く必要がある。

---

## 4. 設計判断履歴

| 日付 | 判断 | 根拠 | 代替案 |
|---|---|---|---|
| 2026-08-14 | 除去キーは前方一致ではなく明示列挙にする | `CLAUDE_CONFIG_DIR` や `ANTHROPIC_*` は利用者の設定であって親セッションの状態ではない。前方一致だと巻き添えになる | `key.startsWith('CLAUDE')`（`ELECTRON_*` と同じ形）。取りこぼしは無いが利用者設定を消す |
| 2026-08-14 | `buildPtyEnv` ではなく `process.env` を起動時に1回掃除する | 除去箇所が1つで済み、探索シェル・`claude agents --json`・PTY のすべてが同じ前提で動く。`buildPtyEnv` に置くと `mergeUserEnv` の埋め戻しと順序で噛み合わない | `buildPtyEnv(mergeUserEnv(strip(process.env), ...))`。探索シェルが再エクスポートするため、探索側にも同じ処理が要る |
| 2026-08-14 | `CLAUDE_EFFORT` も落とす | 親セッションの `/effort` 設定であってアプリの設定ではない。rc に書いている利用者が居れば `mergeUserEnv` が埋め直す | 残す（親の effort が新しいセッションに漏れる） |
