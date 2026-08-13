# Issue #251 claude タブでホイールを回すと、マウス報告が握り潰されて矢印キーが送られる（#238 の回帰） - Overview

> **Issue**: [#251 claude タブでホイールを回すと、マウス報告が握り潰されて矢印キーが送られる（#238 の回帰）](https://github.com/i-iwnl/ai-terminal/issues/251)
>
> #238 で入れた代替画面バッファ用のホイールハンドラが、**マウス報告が有効なときにも呼ばれてマウス報告を握り潰し**、矢印キーの連打に置き換えている。
> Claude Code は起動時に必ずマウス報告を要求するので、claude / gemini タブでは常に踏む。CLI 側は矢印の連打を arrow-burst と判定し「use PgUp/PgDn to scroll」を出す。
>
> 詳細は以下の3ドキュメントに分割:
>
> - `architecture.md` - 触る構造・Contract変更・設計判断
> - `worklog.md` - 時系列の作業ログ・次に再開するとき最初に読むべきこと
> - `known-issues.md` - 判明した問題・未解決事項・先送りしたもの
>
> **最終更新**: 2026-08-13

---

## 1. ゴール

`attachCustomWheelEventHandler` に「マウス報告のプロトコルがホイールを含むなら介入しない」というガードを1つ足し、claude / gemini タブのホイールを CLI 自身のスクロールへ戻す。
#238 が対象にしていた「マウス報告を要求しない代替画面（`less` / `vim` の既定）」での改善はそのまま残す。

| カテゴリ | 対象 |
|---|---|
| 対象トラック | 単一（renderer のみ） |
| ブランチ | `fix/wheel-mouse-report-251` |
| 関連PR | 未作成 |

---

## 2. 完成条件

- [x] 判定を `wheelScroll.ts` の純粋関数へ切り出し、`none` / `x10` は変換・`vt200` / `drag` / `any` は非変換を単体テストで固定する
- [x] ガードを3通り以上壊して、いずれも赤くなることを確認する（単体5通り / E2E 3通り。表は `worklog.md`）
- [x] 代替画面 + マウス報告 ON の端末へのホイールが、矢印ではなく SGR マウス報告として PTY に届くことを E2E で固定する（`S119`）
- [x] 実機（agent-browser + CDP）で、claude タブのホイールが転写をスクロールし「Scroll wheel is sending arrow keys」が出ないことを確認する（対照実験の表は `worklog.md`）
- [x] 型チェック通過（`make check`）
- [x] Lintチェック通過（`make check`）

---

## 3. 現状進捗

| 項目 | 状態 |
|---|---|
| 設計 | 完了 |
| 実装 | 完了 |
| 検証 | 完了（`make check` / `make e2e` EXIT=0 / `make e2e-lint` FAIL=0 / 実機の対照実験） |

---

## 4. 直近の次アクション

| 優先度 | アクション | 詳細 |
|---|---|---|
| **P0** | commit / push / PR | **ユーザーの明示指示待ち**（ルート CLAUDE.md）。ブランチは `fix/wheel-mouse-report-251` |
| P1 | PR #238 に「#251 で訂正した」とコメントする | `known-issues.md` の 1番。PR を出すときに実施 |
