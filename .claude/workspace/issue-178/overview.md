# Issue #178 P1: ターミナル内 URL の外部ブラウザ起動（1件を統合・新規起票を止めるループ） - Overview

> **Issue**: [#178 P1: ターミナル内 URL の外部ブラウザ起動（1件を統合・新規起票を止めるループ）](https://github.com/i-iwnl/ai-terminal/issues/178)
>
> ターミナルに出た URL をクリックすると、既定ブラウザではなく**アドレスバーの無い Electron の窓**が開く（`setWindowOpenHandler` がアプリ全体に0件）。
> さらに素のクリックで発火するため、カーソルを置くつもりのクリックでも窓が開く。統合元は #174。
> **このループの中で新規 Issue を立てない**（見つけたものは `known-issues.md` に書く）。
>
> 詳細は以下の3ドキュメントに分割:
>
> - `architecture.md` - 触る構造・Contract変更・設計判断
> - `worklog.md` - 時系列の作業ログ・次に再開するとき最初に読むべきこと
> - `known-issues.md` - 判明した問題・未解決事項・先送りしたもの
>
> **最終更新**: 2026-08-04

---

## 1. ゴール

ターミナル内のリンクを**既定ブラウザで開く**ようにし、**Cmd+クリックでのみ発火**させる（iTerm2 / Ghostty と同じ作法）。
アプリ内に外部サイトを表示する `BrowserWindow` が生まれないことを、E2E で観測できる形にする。

| カテゴリ | 対象 |
|---|---|
| 対象トラック | 単一（main が主、renderer は `useTerminal.ts` の1箇所） |
| ブランチ | 未作成 |
| 関連PR | 未作成 |

---

## 2. 完成条件

### 周1: 外部リンクを既定ブラウザへ逃がす

- [x] `setWindowOpenHandler` が `shell.openExternal` + `{ action: 'deny' }` を返す（本体ウィンドウ・設定ウィンドウの両方）
- [x] `http` / `https` / `mailto` 以外のスキームは `openExternal` に渡さない（`isSafeExternalUrl` + `test/unit/external-links.test.ts`）
- [x] `window.open()` を呼んでもアプリ内に新しい `BrowserWindow` が生まれないことを E2E が観測する（S92）
- [x] `e2e/scenarios.yml` に S92 の台帳エントリがある

### 周2: リンクの活性化を Cmd+クリックに寄せる

- [x] 素のクリックでリンクが発火しない / `Cmd`+クリックでのみ `openExternal` が呼ばれる（E2E S93）
- [x] 判定は純粋関数に切り出して `test/unit/link-activation.test.ts` が固定する
- [x] `README.md` に「Cmd+クリックで開く」を書いた

### 周3: 「ウィンドウ」メニューの `role: 'close'`

- [x] **見送り**。結論と根拠を `worklog.md` / `architecture.md` に記録した

### 全周共通

- [x] 型チェック・Lint・単体テスト通過（`make check`。38 files / 555 tests）
- [x] `make e2e`（102 passed）/ `make e2e-lint`（`PASS=743 FAIL=0`）/ `make e2e-screenshots-check`（`PASS=38 FAIL=0`）
- [x] 4つの変更点すべてについて「壊すと赤くなる」ことを実測した
- [x] 実機確認（agent-browser + CDP。ローカル HTTP サーバへの GET で観測）

---

## 3. 現状進捗

| 項目 | 状態 |
|---|---|
| 設計 | 完了 |
| 実装 | 完了（周1・周2。周3 は見送り） |
| 検証 | 完了（`make check` / `make e2e` / `make e2e-lint` / `make e2e-screenshots-check` / 実機） |

---

## 4. 直近の次アクション

**残りはユーザーの明示指示が要る作業だけ**（commit / push / PR はエージェントが自発的に行わない）。

| 優先度 | アクション | 詳細 |
|---|---|---|
| **P0** | commit / push / PR 作成 | ユーザーの指示待ち。`main` から生やす（スタック PR を作らない） |
| P1 | Issue #178 / #174 へのコメント書き戻し | 周3 を見送った根拠と、#174 本文の「設定ウィンドウを `Cmd+W` で閉じられない」が既に解消済みだったこと |
| P2 | `known-issues.md` の 2・3 番 | どちらも P3・意図的な見送り。**このループの中では起票しない** |
