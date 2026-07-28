# E2E シナリオを1本追加する

`e2e/scenarios.yml` が「何をテストするか」の唯一の正で、`e2e/specs/` はその実装。両者は必ず1:1対応する（`make e2e-lint` が機械検査する）。

## 手順

### 1. `e2e/scenarios.yml` に id / title / spec を追記する

既存エントリの直後に追加する。`id` は `S<番号>`（次の連番）、`title` は `test()` のタイトルにそのまま使う日本語の一文、`spec` は `e2e/specs/` からの相対パスにする。README 掲載用の画像を出す予定があるなら `screenshot` と `readme: true` も足す（`readme: true` にした場合は `screenshot` の指定が必須。無いと lint の check8 で FAIL する）。

- 終了条件: `e2e/scenarios.yml` に新しいシナリオのエントリが増えている

### 2. `e2e/specs/<ID>-<名前>.spec.ts` を作る

既存 spec（例: [../../../../e2e/specs/S01-launch.spec.ts](../../../../e2e/specs/S01-launch.spec.ts)）と同じ形にする。`launchApp()` / `closeApp()` を `beforeEach` / `afterEach` で呼び、必要ならオプション（`agentsFail` 等）を渡す。オプションの意味は [reference/isolation-harness.md](../reference/isolation-harness.md) を参照。

- 終了条件: ファイルが `e2e/specs/` に存在し、`test()` がちょうど1個ある

### 3. `test()` のタイトルを `<ID> <title>` の形式にする

`e2e/scenarios.yml` に書いた `title` と一字一句一致させ、先頭に `id` と半角スペースを付ける。例: `test('S23 新しい振る舞いの説明', async () => { ... })`。

- 終了条件: タイトル文字列が `<ID> <scenarios.yml の title>` と完全一致している

### 4. 実行して green にする

[run-e2e.md](run-e2e.md) の手順で `make e2e` を実行する。落ちた場合は同ファイルの「落ちたときの調べ方」を使う。

- 終了条件: 追加したシナリオが green になっている（他の21+シナリオを壊していないことも合わせて確認する）

### 5. `make e2e-lint` を通す

- 終了条件: 出力の合計行が `FAIL=0` になっている

## 命名規約

- spec ファイル名の接頭辞（最初の `-` の直前まで）は `scenarios.yml` の `id` と一致させる。一致しないと lint の check4 で FAIL する
- 1 spec = 1 シナリオ。1ファイルに複数の `test()` を書かない（1個以外は lint の check7 で FAIL する）

## `make e2e-lint` が検査する9項目

| check | 検査内容 |
|---|---|
| check1 | レジストリ（scenarios.yml）にあって spec ファイルが `e2e/specs/` に存在しない |
| check2 | `e2e/specs/` に spec があるのにレジストリに無い |
| check3 | id の重複 |
| check4 | spec のファイル名の接頭辞が id と一致しない |
| check5 | spec 内の `test()` タイトルに id が含まれていない |
| check6 | spec 内の `test()` タイトルがレジストリの `title` と `<ID> <title>` 形式で一致しない |
| check7 | 1つの spec ファイルに `test()` が複数、または0個ある |
| check8 | `readme: true` なのに `screenshot` が指定されていない |
| check9 | `screenshot` が指定されているのに `docs/images/<名前>` が存在しない（WARN。実装が進んだら生成する） |

## DoD（完了条件）

- 手順1〜5をすべて終えている
- `make e2e` が green（追加分・既存分とも）
- `make e2e-lint` が `FAIL=0`
- 全部 green になるまで完了扱いにしない
