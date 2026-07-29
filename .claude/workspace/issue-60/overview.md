# Issue #60 tmux の -A が既存セッションに当たらず、Cmd+W した claude にアプリから二度と戻れない - Overview

> **Issue**: [#60 tmux の -A が既存セッションに当たらず、Cmd+W した claude にアプリから二度と戻れない](https://github.com/i-iwnl/ai-terminal/issues/60)
>
> tmux セッション名が resume のたびに fresh な UUID になるため、`tmux new-session -A` が
> 既存セッションに当たることが原理的にありえなかった。`Cmd+W` で閉じた `claude` は
> 生き続けたままアプリから到達不能になり、CPU とトークンを消費し続ける。
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

「同じ claude セッションに対しては、常に同じ tmux セッション名になる」状態にする。
これにより、`Cmd+W` で閉じたタブに履歴からの resume で戻ったとき、新しい `claude` を起動するのではなく
**生きている tmux セッションへアタッチし直す**。

| カテゴリ | 対象 |
|---|---|
| 対象トラック | 単一（main の PTY 層のみ） |
| ブランチ | `fix/issue-60-tmux-session-name`（`fix/issue-58-cwd-tracking` の上にスタック） |
| 関連PR | #73 |

---

## 2. 完成条件

- [x] resume 時にも安定したセッション名が決まる（`buildClaudePlan` が `agentSessionId` を返す）
- [x] `tmux.ts` の冒頭コメントが実装と一致している（claude と gemini の非対称を明記）
- [x] 「同じセッションを2回 resume すると tmux セッション名が一致する」ことが単体テストで固定されている
- [x] 修正前のコードでそのテストが赤くなることを確認した
- [x] 型チェック通過（`make check`）
- [x] Lintチェック通過（`make check`）

---

## 3. 現状進捗

| 項目 | 状態 |
|---|---|
| 設計 | 完了 |
| 実装 | 完了 |
| 検証 | 完了（typecheck / lint / unit 137 件） |

---

## 4. 直近の次アクション

| 優先度 | アクション | 詳細 |
|---|---|---|
| **P0** | 実機で「Cmd+W -> 履歴から resume」を1度なぞる | E2E は tmux 経路を対象外にしている（#15）。自動検証の穴は `known-issues.md` の 1 |
| P1 | #66（tmux でラップされたタブが見分けられない）を検討する | 「このタブは tmux の中」が見えないと、戻れることに気づけない |
