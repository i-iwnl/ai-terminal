# Architecture

Issue #24 における変更対象の構造。
設計判断の根拠は末尾の「設計判断履歴」を参照。

---

## 1. 対象トラック

shared（状態判定）+ main（通知・Dock）+ renderer（タブのフォーカス）の3トラック。

| コンポーネント | 変更内容 | 影響範囲 |
|---|---|---|
| `src/shared/agent-status.ts` | **新規**。状態の意味・ラベル・件数・遷移判定 | TaskList / poller の両方 |
| `src/renderer/src/sidebar/TaskList.tsx` | 変更（自前の判定を捨てて共通実装を参照） | - |
| `src/main/agents/poller.ts` | 変更（共通実装の参照・Dock バッジ・バウンス・通知クリック） | - |
| `src/main/notify/index.ts` | 変更（`NotifyOptions.onClick`） | Renderer からの `notify:show` は無影響（省略時は従来どおり） |
| `src/shared/ipc.ts` | 変更（`IpcEvent.focusSession` / `RendererApi.session`） | preload・Renderer |
| `src/preload/index.ts` | 変更 | Renderer |
| `src/renderer/src/App.tsx` | 変更（`session.onFocus` の購読） | - |
| `e2e/specs/S38-dock-badge.spec.ts` / `test/unit/agent-status.test.ts` | **新規** | `e2e/scenarios.yml` |

---

## 2. Contract（src/shared/ipc.ts）変更

| チャンネル / 型 | 変更 | 内容 |
|---|---|---|
| `IpcEvent.focusSession` | ADD | `session:focus`。payload は `agentSessionId`（string） |
| `RendererApi.session.onFocus` | ADD | 購読解除関数を返す |

`NotifyRequest` は変えていない。クリック時の処理は IPC の payload ではなく Main 内のコールバック（`NotifyOptions`）として渡す。**Renderer から関数は送れないので、payload に載せる形にはできない。**

---

## 3. 技術的制約・前提条件

- **状態判定の唯一の正は `src/shared/agent-status.ts`。** 表示・通知・Dock の3箇所が同じ実装を参照する。3箇所が別々に `status === 'busy'` を書くと、CLI が新しい値を返し始めたときに片方だけが追従して食い違う（実際に「UI は不明と出すが通知は作業完了と言う」状態が生まれかけていた）
- **Dock バッジは `notifyOnIdle` から独立させる。** `detectAndNotifyCompletions()` は `notifyOnIdle` が false のとき早期 return するので、その中にバッジ更新を置くと**通知を切った人がバッジも失う**
- **バウンスはウィンドウが前に無いときだけ。** 見ている最中に弾ませても意味が無く、うるさいだけ
- **`app.setBadgeCount` は macOS / Linux のみ。** 存在チェックしてから呼ぶ（呼べない環境で落とさない）
- **通知のクリックは自動テストできない。** OS の通知センターを操作する手段が無い

---

## 4. 設計判断履歴

| 日付 | 判断 | 根拠 | 代替案 |
|---|---|---|---|
| 2026-07-29 | 状態判定を `src/shared/agent-status.ts` に切り出す | この Issue で判定が3箇所目（表示・通知・Dock）になる。二重化を放置したまま3つ目を足すのが一番まずい | 各所で `status === 'busy'` を書く（現状の延長。CLI の仕様変更で片方だけ壊れる） |
| 2026-07-29 | `becameYourTurn()` で未知の語への遷移も「作業が終わった」側に数える | **通知が来ないことには気づけない。** 迷ったら通知する側に倒すほうが安全 | 未知への遷移は通知しない（静かだが、CLI の語が変わった瞬間に通知が全部止まる） |
| 2026-07-29 | `countYourTurn()` では未知を数えない | Dock バッジは「あなたを待っている件数」。分からないものを人間の番として催促しない | 未知も数える（実態より多い件数で急かすことになる） |
| 2026-07-29 | クリック時の処理を `NotifyOptions.onClick` で渡す | Renderer から関数は送れないので `NotifyRequest` には載せられない。IPC 経由の `notify:show` では省略され、従来どおり動く | `NotifyRequest` に `focusSessionId` を足す（Renderer からの呼び出しでは意味を持たないフィールドが増える） |
| 2026-07-29 | 対応するタブが無いときは何もしない（ウィンドウの前面化だけ） | 通知のクリックで**新しいプロセスを起動する**のは副作用が大きすぎる。`--resume` で開く案は魅力的だが、意図しない起動の危険がある | 見つからなければ resume で開く（`known-issues.md` に残した） |
| 2026-07-29 | S38 で「0 より大きい」ではなく **1**（総数の 2 ではない）を見る | 緩い判定にすると、busy 側を数える逆の実装でも緑になる。実際に総数へ変えて赤くなることを確認した | `toBeGreaterThan(0)` |
