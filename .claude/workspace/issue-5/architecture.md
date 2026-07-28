# Architecture

Issue #5 における変更対象の構造。
設計判断の根拠は末尾の「設計判断履歴」を参照。

---

## 1. 対象トラック

main（PTY・agents・history に memo / notify を追加）+ renderer（メモパネル・設定パネル）の2トラック。

| コンポーネント | 変更内容 | 影響範囲 |
|---|---|---|
| `src/main/memo/store.ts` | 追加 | `~/.ai-terminal/memos.json` の読み書き。`history/titles.ts` と同じ `stableId` を保存キーに使う |
| `src/main/notify/` | `notify.ts` から昇格・分割 | `index.ts`（通知の入口）/ `sound.ts`（音源探索と afplay）/ `webhook.ts`（Slack・Discord） |
| `src/main/config.ts` | 変更 | `notifySoundId` / `slack` / `discord` を追加。`coerce` を `coerceConfig` として export（単体テスト用） |
| `src/main/index.ts` | 変更 | `registerMemoHandlers()` の登録 |
| `src/renderer/src/sidebar/MemoPanel.tsx` | 追加 | メモタブ本体 |
| `src/renderer/src/sidebar/Sidebar.tsx` | 変更 | 3タブ化。履歴 -> メモの遷移状態（`memoTarget`）を保持する |
| `src/renderer/src/sidebar/HistoryList.tsx` | 変更 | 行に「メモ」ボタンを追加。操作ボタンの class を `__edit` -> `__action` に変更 |
| `src/renderer/src/settings/SettingsPanel.tsx` | 追加 | 設定モーダル |
| `src/renderer/src/tabs/TabBar.tsx` | 変更 | 設定ボタンを追加 |
| `src/renderer/src/lib/shortcuts.ts` | 変更 | `Cmd+,` を追加 |
| `test/` | 追加 | vitest の単体テストとスタブ（`electron` / `node-pty`） |
| `e2e/fixtures/harness.ts` | 変更 | `hidden` オプション（ヘッドレス実行） |

---

## 2. Contract（src/shared/ipc.ts）変更

| チャンネル / 型 | 変更 | 内容 |
|---|---|---|
| `MemoScope` / `MemoEntry` / `SetMemoRequest` / `ListMemosResult` | ADD | メモの型。`scope` で全体 / セッションを分ける |
| `memo:list` / `memo:set` | ADD | メモの取得と更新。`set` は更新後の一覧を返す（Renderer 側で再取得しない） |
| `WebhookConfig` | ADD | `{ enabled, url }`。`AppConfig.slack` / `AppConfig.discord` として持つ |
| `AppConfig.notifySoundId` | ADD | 通知音の識別子。空文字は「OS 既定」 |
| `SoundOption` / `notify:list-sounds` | ADD | 選択できる通知音の一覧 |
| `PlaySoundRequest` / `notify:play-sound` | ADD | 試聴 |
| `TestWebhookRequest` / `WebhookSendResult` / `notify:test-webhook` | ADD | Webhook のテスト送信。保存前の URL を渡せる |

**保存キーの形は Renderer に露出していない。** `memo:set` は `{ scope, provider, stableId }` を受け取り、`session:<provider>:<stableId>` への変換は Main の中で閉じている。

---

## 3. 技術的制約・前提条件

- **Renderer は OS を直接触らない**（ルート CLAUDE.md の鉄則1）。音源の走査・`afplay` の起動・Webhook の HTTP はすべて Main
- **外部フォーマットのパース失敗でアプリを落とさない**（同 鉄則5）。`memos.json` も壊れていれば空マップへ縮退する
- **`AppConfig` の更新は浅いマージ**（`setConfig` が `{ ...getConfig(), ...patch }`）。`slack` / `discord` のような入れ子はオブジェクト全体を送る必要がある。設定パネル側にコメントで明記済み
- **Electron に真のヘッドレスモードは無い。** `BrowserWindow` はネイティブウィンドウを要求する

---

## 4. 設計判断履歴

| 日付 | 判断 | 根拠 | 代替案 |
|---|---|---|---|
| 2026-07-28 | メモは全体 + セッション単位の両方を持つ | 全体だけだと「どのセッションの話か」が失われ、セッション単位だけだと行き場のない走り書きの置き場が無くなる | 全体のみ / セッションのみ |
| 2026-07-28 | セッションメモの保存キーは `stableId` | `sessionId` は gemini では行番号由来で並び替わると別セッションを指す。`session-titles.json` が既に `stableId` を使っており、揃える | `sessionId` を使う |
| 2026-07-28 | メモに保存ボタンを置かない（自動保存） | ターミナルを触りながら書き殴る用途。保存操作を意識させたくない。空にすれば消えるので削除 UI も要らない | 保存ボタン + 削除ボタン |
| 2026-07-28 | 通知音は `afplay` で自前再生し、Notification は `silent: true` | Electron の `Notification({ sound })` では「通知を出さずに試聴する」ができず、設定画面の試聴ボタンが作れない。両方鳴らすと二重に聞こえる | Notification の sound オプションを使う |
| 2026-07-28 | 設定パネルに保存ボタンを置かない | 変更のたび `config:set` に流し、Main が正規化した結果を state に戻す。範囲制限（fontSize 6〜48 等）が UI 側と二重管理にならない | ローカル state に溜めて保存ボタンで確定 |
| 2026-07-28 | Webhook のホスト名は縛らず、スキームだけ http/https に限定 | Slack / Discord 互換のエンドポイントを自前で立てる構成がありうる。`file:` などは弾く必要がある | ホスト名のホワイトリスト / 検証しない |
| 2026-07-28 | ヘッドレス実行はテスト側から `BrowserWindow.hide()` を呼ぶ | 環境変数でアプリ側の `win.show()` を抑制する案は、隔離ハーネスの前提「アプリのコードには手を入れない」を崩す | アプリに `AI_TERMINAL_HEADLESS` を実装する |
| 2026-07-28 | 単体テストの対象は「外部に触れない純粋関数」に限る | Electron を起動する検証は E2E が既に担保している。層を分けないと単体テストが遅く壊れやすくなる | jsdom で React コンポーネントもテストする |
| 2026-07-28 | `electron` / `node-pty` はスタブに差し替え、振る舞いを実装しない | スタブに振る舞いを足したくなったら、それは「テストしたい関数が副作用と同居している」サイン。対象側を切り出すべき | モックライブラリで挙動を再現する |
| 2026-07-28 | 開発ループは新規 skill ではなく `/workspace-plan` の operation として足す | `status` で始まり `update` で終わるループなので、外部記憶と同じ skill にある方が導線が短い | 新規 `/dev-loop` skill を立てる |
| 2026-07-28 | E2E の locator を class から `aria-label` に変えた（S27 / S28） | 履歴行のボタンが1個から2個に増え、class 名も変わった。**表示の都合で変わる class にテストを結び付けない** | class 名を変えずにボタンを足す |
