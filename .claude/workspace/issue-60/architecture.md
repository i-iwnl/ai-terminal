# Architecture

Issue #60 における変更対象の構造。
設計判断の根拠は末尾の「設計判断履歴」を参照。

---

## 1. 対象トラック

単一トラック（main の PTY 層のみ）。Renderer のコードは1行も変えていない。

| コンポーネント | 変更内容 | 影響範囲 |
|---|---|---|
| `src/main/pty/manager.ts` | 変更（`buildClaudePlan` が resume でも `agentSessionId` を返す） | tmux セッション名 / `markOwnedSession` / `SpawnPtyResult` |
| `src/main/pty/tmux.ts` | 変更（コメントのみ。実装と食い違っていた記述の是正） | なし |
| `src/shared/ipc.ts` | 変更（`SpawnPtyResult.agentSessionId` のコメントのみ。**型は変えていない**） | Renderer が受け取る値の意味 |

---

## 2. Contract（src/shared/ipc.ts）変更

**型の変更は無い。値の意味が変わる。**

| チャンネル / 型 | 変更 | 内容 |
|---|---|---|
| `SpawnPtyResult.agentSessionId` | ALTER（意味のみ） | 「新規起動で採番した UUID。resume では undefined」から「その claude セッションを一意に識別する ID。resume では再開先の ID が入る」へ |

型に現れない変更なので、`ipc.ts` と `manager.ts` のコメントに明記した。

**副作用（意図した改善）**: `src/renderer/src/App.tsx` の `canFocusTaskTab` は `tab.agentSessionId` でタブを探している。
resume でもこの値が埋まるようになったため、**履歴から再開したタブも、サイドバーのタスク一覧の行から選べるようになる**。
Renderer 側は無変更でこの改善が効く。

---

## 3. 技術的制約・前提条件

- **tmux 永続化の検証手段が無い**（Issue #15）。E2E ハーネスは `useTmux: false` で固定しており、tmux 経路は E2E の対象外。したがって本 Issue の担保は**単体テストと実機確認**に限られる。
- `Cmd+W` は tmux クライアントを kill するだけで、サーバ側のセッションと `claude` プロセスは残る。これは tmux の仕様で、変えない（**残ること自体は望ましい**。問題は名前が再現できず到達不能になることだった）。
- gemini には安定したセッション ID が無い（`--resume` は `latest` か index を受け取るだけ）。

---

## 4. 設計判断履歴

| 日付 | 判断 | 根拠 | 代替案 |
|---|---|---|---|
| 2026-07-29 | **`buildClaudePlan` が resume でも `agentSessionId`（= 再開先のセッション ID）を返す** | tmux セッション名の材料は「その claude セッションに対して常に同じ値」でなければならない。resume 時に手元にある唯一の安定キーが `resumeSessionId` そのもの。別のキーを新設すると、それ自体をどこかに永続化する必要が出る | 「ptyId とセッション ID の対応表をアプリ側に永続化する」案。保存先・寿命・掃除の設計が要り、CLI が持っている ID をわざわざ二重管理することになる |
| 2026-07-29 | **`markOwnedSession` の `plan.agentSessionId ?? req.resumeSessionId` から後半を落とした** | `kind === 'claude'` なら `plan.agentSessionId` が必ず埋まるようになり、後半は到達不能になったため。挙動は変わらない | 残したままにする案。読む人が「resume では前半が undefined になりうる」と誤読する |
| 2026-07-29 | **gemini は直さず、直せないことをコメントとテストで固定した** | CLI 側に一意なセッション ID が無いため、アプリ側だけでは解決できない。**「未実装」ではなく「CLI の制約」であることを明示しないと、次の人が同じ調査をやり直す** | gemini 用に別のキー（起動時刻など）を作る案。同じセッションを resume したことを判定できないので、名前が一致しない |
| 2026-07-29 | **E2E は追加しない** | tmux 永続化の検証手段が無いことは Issue #15 が既に持っている。E2E ハーネスは `useTmux: false` 固定で、有効化すると PTY の exit が発火せず他シナリオの前提が壊れる | 無理に E2E を書く案。tmux を有効にしたハーネスを別に用意することになり、Issue #15 の範囲を先取りして重複する |
