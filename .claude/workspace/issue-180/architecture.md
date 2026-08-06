# Architecture

Issue #180 における変更対象の構造。
設計判断の根拠は末尾の「設計判断履歴」を参照。

---

## 1. 対象トラック

単一トラック。ただし周によって重心が入れ替わる。

| コンポーネント | 変更内容 | 影響範囲 |
|---|---|---|
| `src/renderer/src/styles.css` | 変更（引き継ぎ周5-b / #180 周8） | `docs/images/` の撮り直し判定・`S40` / `S41` の実測固定 |
| `src/renderer/src/components/TabBar.tsx` | 変更（引き継ぎ周5-b / 周7 / #180 周8） | `S06` / `S51` / `S54` / `S64` / `S95` |
| `src/main/menu.ts` | **完了**（#180 周3 = #152 / #145。PR #208 / #209） | 判定は `src/main/menu-action-routing.ts` へ切り出し済み。**この面はいま空いている** |
| `src/main/menu-action-routing.ts` | 新規（#180 周3 = #152） | `test/unit/menu-action-routing.test.ts` が唯一の関門（**E2E からは踏めない**。`known-issues.md` 6番） |
| `src/main/window-state.ts` | **完了**（#180 周4-a = #153。PR #211） | `settings` キーを足して相乗り。**書き手が2つになったので、保存前に相手のキーを読む**（`S98` が固定） |
| `src/main/accessibility.ts` | **完了**（#180 周4-b = #149。PR #215） | 宛先を**イベントのたびに解決**する形へ（`config.ts` の `broadcastConfig` と同型）。Contract は不変だが `ipc.ts` の doc に配信範囲を明記した |
| `src/shared/screen-reader-mode.ts` | 新規（#180 周4-b = #149。PR #213 / #214） | 実効値の判定と注記の文言の唯一の正。**本体ウィンドウと設定ウィンドウの2つが読む** |
| `e2e/` | 追加（周ごと） | `scenarios.yml` との1:1（`make e2e-lint`） |

---

## 2. Contract（src/shared/ipc.ts）変更

| チャンネル / 型 | 変更 | 内容 |
|---|---|---|
| `SpawnPtyRequest` | **ALTER**（周 6' = #155 / PR 1） | `geminiAgentSessionId?: string` を追加。gemini を resume するときの内部 UUID（`SessionHistoryEntry.stableId`）を Main へ運ぶ。**用途は tmux セッション名の安定化だけ** |
| `SpawnPtyResult.agentSessionId` | **ALTER**（同上） | doc のみ。「gemini には安定した ID が無いため常に undefined」を撤回し、**用途が2つあり claude と gemini で数が違う**ことを明記（tmux 名の種は両方 / `claude agents --json` との突き合わせは claude だけ） |
| `AgentTasksEvent.liveSessions` | **ALTER**（周13 / PR 1） | tmux で生きている、このアプリ由来のセッション（`agentSessionId` / `provider` / `cwd`）。**`tasks` とは出自が違い、`gemini --list-sessions` に出ない gemini も入る**（12番の本体を解く材料）。⛔ 起動コマンドの文字列は載せない（採番した UUID が生で入る）。重複は受け取り側が `agentSessionId` で突き合わせて落とす |
| `AgentTask.recoverable` | **ALTER**（周12 / PR #231） | `aiterm-<sessionId>` の tmux セッションが生きているか。Main の poller が**1周期に tmux を1回だけ**叩いて埋める（`src/main/pty/tmuxSessions.ts`）。⛔ **未取得・失敗は false に倒す**（押した先で新しいプロセスが生えないように）。⭐ **`ownedByApp` の代わりに使える**（あれは Main のメモリで再起動すると空になるが、tmux 名が付いていること自体が「このアプリが起動した」の証拠になる） |

⛔ **新チャンネルは足していない。** 既存 `pty:spawn` の payload を広げただけなので、
`/electron-ipc` の `add-ipc-channel.md` の4ステップのうち **preload（ステップ3）は変更なし**。

⛔ **`geminiResumeTarget` と `geminiAgentSessionId` を兼用しない。** 前者は `--resume` に渡す index、
後者は tmux 名にだけ使う UUID。**混ぜると「`--resume` に UUID を渡す」事故になり、
数字始まりの UUID（全体の約 62%）は index として解釈されて既存のセッションファイルを失う**
（2026-08-06 実測 / 2回再現）。**名前に `Resume` を入れていないのもそのため**
（design-review で「`geminiResumeStableId` は `--resume` に渡す値と読まれる」と2人が指摘した）。

---

## 3. 技術的制約・前提条件

- **`:root` にリテラル hex を置かない / 本体に色リテラルを書かない**（どちらも単体テストが落とす）。
  値を変える周では `make css-substitution-check` が落ちてよいが、**落ちた行がトークンの行だけ**であることを確認する
- ⛔ **アクセント色でハイライトしない**（`design-rules.md` の却下1.70）
- ⛔ **`--focus-ring` の白 = 選択中**。他の用途に白を使わない
- ⛔ **`scrollIntoView` には `block: 'nearest'` を必ず付ける**（付けないと #170 と同じ「タブが上に押し出される」を再生産する）
- ⛔ **`.main` に `overflow` を足すと `.notice-list` が #170 と同型で全消えする**（`S55` は `toBeVisible()` 系なので気づかない）
- **数値を CSS のコメントに書かない**（実測の正は `S40` / `S41`）
- ルート CLAUDE.md の鉄則（Renderer は OS を直接触らない / PTY 出力を加工しない / IPC は `src/shared/ipc.ts` が唯一の正）

---

## 4. 設計判断履歴

| 日付 | 判断 | 根拠 | 代替案 |
|---|---|---|---|
| 2026-08-05 | #179 の周5-b / 周7 を **#180 のループへ引き取る** | 「open な Issue = エージェントが進められるもの」を保つ。#179 は対象7件を全 close して閉じており、追跡だけのために reopen すると open 件数の意味が濁る | #179 を reopen する / 新規起票する（⛔ 掟で禁止） |
