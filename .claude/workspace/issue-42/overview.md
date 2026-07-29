# Issue #42 E2E に本番忠実度レーンを足す - Overview

> **Issue**: [#42 E2E に本番忠実度レーンを足す（PATH 解決の再発防止シナリオ + パッケージ版スモークを install-app の関門化）](https://github.com/i-iwnl/ai-terminal/issues/42)
>
> Issue #40 が「E2E 全 green のまま本番でだけ壊れる」形で起きた反省から、(1) PATH 解決を端から端まで踏む再発防止シナリオ、(2) 本物の .app を起動するパッケージ版スモークを `make install-app` の関門にする、(3) 自動化の天井の文書化、の3点を入れる。
>
> 詳細は以下の3ドキュメントに分割:
>
> - `architecture.md` - 触る構造・Contract変更・設計判断
> - `worklog.md` - 時系列の作業ログ・次に再開するとき最初に読むべきこと
> - `known-issues.md` - 判明した問題・未解決事項・先送りしたもの
>
> **最終更新**: 2026-07-29

---

## 1. ゴール

バグの発生層（ロジック / 結合 / パッケージング / 起動環境 / 配布）ごとに検証手段を対応させ、「出荷する成果物そのものを、出荷する瞬間に検証する」流れを `make install-app` に組み込む。

| カテゴリ | 対象 |
|---|---|
| 対象トラック | 単一（e2e ハーネス + Makefile + 文書。アプリ本体は変更しない） |
| ブランチ | `feat/issue-42-production-fidelity-e2e`（PR #41 の上に積む） |
| 関連PR | 未作成 |

---

## 2. 完成条件

- [x] S39 が green で、shell-path.ts の PATH 解決を意図的に壊すと赤くなることを確認済み（バグ版 buildProbeCommand で赤・修正版で緑を実測）
- [x] `make e2e-packaged` がパッケージ版 .app に対してスモークを実行し green（4本 / 5.4s）
- [x] `make install-app` はスモークが落ちると /Applications を入れ替えない（スモークの非ゼロ終了と、rm -rf より前に関門が入ることを確認）
- [x] `make e2e-lint` FAIL=0、既存の `make check`（99件）/ `make e2e`（39本）が green
- [x] limitations.md ほか文書が実態と一致（README のシナリオ数 35→39 の陳腐化も是正）

---

## 3. 現状進捗

| 項目 | 状態 |
|---|---|
| 周1: S39 再発防止シナリオ | 完了 |
| 周2: パッケージ版スモークレーン | 完了 |
| 周3: 文書 | 完了 |

---

## 4. 直近の次アクション

| 優先度 | アクション | 詳細 |
|---|---|---|
| **P0** | コミット・PR 作成（ユーザー指示待ち） | ブランチ `feat/issue-42-production-fidelity-e2e`（PR #41 の上） |
