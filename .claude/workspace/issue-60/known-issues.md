# Known Issues

実装中に発見された未解決のバグ・先送りした課題。
詳細な観察記録は `worklog.md` を参照。

---

## 棚卸し（2026-08-04）

**実コードで1件ずつ現状を測り直した結果**（main = 61edbe5 時点）。
`.claude/skills/workspace-plan/operations/promote-known-issues.md` の手順による。
**元の記述は観察の記録として残す。** 状態の唯一の正は GitHub Issue。

| 項目 | 判定 | 根拠 |
|---|---|---|
| 1. 生きた tmux セッションへ戻れることを検証していない | **生きている → #154** | 症状は生存（手動確認の記録が `.claude/workspace/` にも `.claude/skills/` にも1件も無い）。ただし**書かれた原因は3点とも覆っている** — (a)「有効にすると PTY の exit が発火しなくなる」は #121 の 5 番が 2026-08-03 / tmux 3.7b で実測して否定済み、(b)「ハーネスは `useTmux: false` で固定」は既定値にすぎず S84 が上書きしている、(c) #15 は CLOSED で「**本物の tmux による自動検証は作らない**」（tmux サーバが `/private/tmp/tmux-<uid>/default` というプロセス横断の資源で隔離できないため）に決着済み。**残るのは手動確認1回だけ** |
| 2. gemini は tmux セッションを拾い直せない | **生きている。かつ着手条件が成立した → #155** | 実装は不変（`buildGeminiPlan()` は `agentSessionId` を返さず、tmux 名が使い捨て `ptyId` になる）。**しかし「対処しない」の根拠だった CLI 側の制約が消えている** — ローカルの Gemini CLI は 0.53.0 で `--help` に `--session-id  Start a new session with a manually provided UUID.` が存在する。`--list-sessions` の行末 `[UUID]` は `src/main/history/reader.ts` の `GEMINI_LINE_RE` が既に `stableId` として拾っている |

**記述のずれ（重要）**: 2 番の「こちらが ID を採番することも、CLI から一意な ID を得ることもできない」は**現行 CLI では2点とも偽**。同じ誤った前提が `src/main/pty/tmux.ts` の冒頭コメント・`test/unit/pty-plan.test.ts`・`README.md`・`.claude/skills/terminal/reference/pty-pitfalls.md` の**4箇所に転記されている**（`reader.ts` の基準は v0.37.0 で古い）。#121 の 5 番が潰した「tmux の記述が実測と逆」と同型の負債。

また `README.md` と `pty-pitfalls.md` の「claude は履歴から resume すれば同じプロセスに戻れる」は**実測日の併記が無い未検証の断定**で、#154 の確認対象。

---


## 1. 「実際に生きた tmux セッションへ戻れる」ことは自動検証できていない

> **GitHub Issue**: [#154](https://github.com/i-iwnl/ai-terminal/issues/154)

### 症状

単体テストが担保しているのは「**同じ claude セッションなら tmux セッション名が一致する**」ところまで。
実際に `tmux new-session -A` が既存セッションへアタッチし、生きていた `claude` の画面が戻ってくることは検証していない。

### 原因

E2E ハーネス（`e2e/fixtures/harness.ts`）は `useTmux: false` で固定されている。
有効にすると PTY の exit が発火しなくなり、他シナリオの前提が壊れる。
tmux 永続化の検証手段が無いことは **Issue #15** が持っている（重複させない）。

### 影響範囲

- Issue #60 の修正そのもの
- 将来 tmux まわりを触る変更全般

### 対処方針

- [ ] 実機で1度なぞる: 設定で tmux を有効にする -> `Cmd+Shift+C` で claude を起動 -> 何か作業させる -> `Cmd+W` で閉じる -> サイドバーの履歴からそのセッションを resume -> **新規起動ではなく、閉じる前の画面が戻ることを確認する**
- [ ] 検証手段そのものは #15 で扱う

### 優先度

P2

### ステータス

未対処（手動確認待ち）

---

## 2. gemini は tmux セッションを拾い直せない（CLI 側の制約）

> **GitHub Issue**: [#155](https://github.com/i-iwnl/ai-terminal/issues/155)

### 症状

gemini のタブを `Cmd+W` で閉じると、tmux の中の gemini プロセスは残るが、**アプリからは二度と到達できない**。
claude と同じ症状が gemini にだけ残っている。

### 原因

gemini には安定したセッション ID が無い。`--resume` が受け取るのは `latest` か index で、
こちらが ID を採番することも、CLI から一意な ID を得ることもできない。
そのため tmux セッション名は `ptyId`（起動のたびに使い捨てる UUID）に頼るしかない。

### 影響範囲

- gemini タブのみ。claude タブは Issue #60 の修正で解決済み

### 対処方針

- [ ] gemini CLI に `--session-id` 相当が入ったら対称にする（`buildGeminiPlan` が `agentSessionId` を返せるようになる）
- 現状は `src/main/pty/tmux.ts` の冒頭コメントと単体テストで「そういう仕様である」ことを固定してある

### 優先度

P3

### ステータス

対処しない（CLI 側の制約。記録のみ）

---
