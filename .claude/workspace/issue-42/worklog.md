# Worklog

時系列の作業ログ。**設計判断の根拠**と**学んだ教訓**を中心に記録する。
コード差分は git log を参照、現状の構造は `architecture.md` を参照。

---

## 2026-07-29 - Issue 起票・ワークスペース作成

### 実施内容

- Issue #40 の反省（E2E 全 green のまま本番でだけ壊れた）から、本番忠実度レーンの設計を提案しユーザー承認
- Issue #42 起票、ブランチ `feat/issue-42-production-fidelity-e2e` を PR #41 の上に作成

### 次に再開するとき最初に読むべきこと

- 実装はこれから。周1（S39 再発防止シナリオ）→ 周2（パッケージ版スモーク + install-app 関門）→ 周3（文書）の順
- S39 の肝: 偽 claude を PATH に置かず、一時 HOME の .zshrc で PATH に足す。shell-path.ts の解決が壊れているとタスク一覧が出ない、が検証内容

---

## 2026-07-29 - 周1〜3 実装・検証・文書（同日）

### 実施内容

- 周1: ハーネスに `cliOnlyViaLoginShell` オプションを追加（偽 CLI を .zshrc 経由でのみ露出）し、S39 を追加。
  **バグ版 buildProbeCommand（$PATH 直結）に一時的に戻して S39 が赤くなることを実測**してから戻した
- 周1副産物: ハーネスの env に `SHELL=/bin/zsh` を固定（.zshrc + ZDOTDIR で zsh 前提だったのにシェル自体は開発機任せだった）
- 周2: `package:dir`（dmg なし高速版）、`make e2e-packaged`、内部ターゲット `e2e-packaged-run` を追加。
  ハーネスは環境変数 `AI_TERMINAL_E2E_PACKAGED_APP` があれば executablePath で dist/ の .app バイナリを起動する。
  スモークは S01 / S09 / S12 / S39 の4本（asar・isPackaged・preload・asarUnpack した node-pty・shell-path を踏む選定）。
  `make install-app` は package 直後・入れ替え前にスモークを関門として実行し、落ちたら /Applications を触らない
- 周3: limitations.md に「本番忠実度の階段と自動化の天井」を追記、isolation-harness.md にオプション追加、
  README（コマンド・テスト3層・install-app の関門）と CLAUDE.md（コマンド一覧）を更新、
  e2e SKILL.md の description からシナリオ数のハードコード（35のまま陳腐化していた）を除去
- 検証: make check 99件 / make e2e 39本 / make e2e-packaged 4本 / make e2e-lint FAIL=0 / lint-skills FAIL=0

### 設計判断

- スモークの実行は install-app の関門に埋め込む（独立コマンドだけだと形骸化する）。architecture.md 参照
- Playwright の electron.launch は packaged バイナリの executablePath 指定でそのまま動いた
  （Electron の EnableNodeCliInspectArguments フューズが既定で有効なため。フューズを切る場合はこのレーンが壊れる）

### 教訓

- ドキュメントに書いたシナリオ数はすぐ陳腐化する（README「全35」が実際は38だった）。総数は書かない方が保守的
- 「テストが不具合で赤くなること」の確認は、バグを一時再導入して赤→戻して緑、で機械的にやれる。今回それで S39 の検出力を実証できた

### 次に再開するとき最初に読むべきこと

- 実装・検証・文書はすべて完了。残るはコミットと PR 作成（ユーザーの指示待ち）。
  ブランチは `feat/issue-42-production-fidelity-e2e` で PR #41 の上に積んである（#41 が先にマージされたら base を main にして作る）
