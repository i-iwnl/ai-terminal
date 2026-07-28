# Worklog

時系列の作業ログ。**設計判断の根拠**と**学んだ教訓**を中心に記録する。
コード差分は git log を参照、現状の構造は `architecture.md` を参照。

---

## 2026-07-28 - メモ / 通知転送 / サウンド / 設定パネルの実装と、テスト層の2段化

### 実施内容

| 機能 | 実装 |
|---|---|
| メモ（全体 + セッション単位） | `src/main/memo/store.ts` / `src/renderer/src/sidebar/MemoPanel.tsx`。保存先は `~/.ai-terminal/memos.json` |
| Slack / Discord への通知転送 | `src/main/notify/webhook.ts`。global fetch + 5秒タイムアウト |
| 通知音のカスタマイズ | `src/main/notify/sound.ts`。`/System/Library/Sounds` と `~/Library/Sounds` を走査し `afplay` で再生 |
| 設定パネル | `src/renderer/src/settings/SettingsPanel.tsx`。タブバーの「設定」ボタンと `Cmd+,` |

テスト基盤:

- **vitest を導入し、単体テスト層を新設**（`test/unit/`、54 ケース）。`make check` を typecheck + lint + unit に変更
- E2E を4本追加（S29 全体メモ / S30 セッションメモ / S31 設定パネル / S32 Webhook 送信）。全32シナリオ
- `make e2e-headless` を追加（ウィンドウを表示せずに実行）

skill:

- `/workspace-plan` に `operations/loop.md` を追加。指示 -> 計画 -> 実装 -> 検証 -> 文書 -> 記録 の1周と、その停止条件を定義
- ルート CLAUDE.md の委譲表に載せ、実装を伴う依頼の既定の入口にした

### 設計判断

主要な判断は `architecture.md` の「4. 設計判断履歴」に表として集約した。ここには経緯だけ残す。

- **ヘッドレス実行は「アプリを変えない」制約の中で実現した。** 環境変数で `win.show()` を抑制する案が最初に浮かんだが、隔離ハーネスの前提を崩す。テスト側から `app.evaluate()` で `BrowserWindow.hide()` を呼ぶ方式に落ち着いた
- **ヘッドレスで検証範囲が狭まらないことを、推測ではなく実測で確認した。** 隠したウィンドウでも `requestAnimationFrame` は 61 フレーム/秒で回り、WebGL レンダラの非背景ピクセルは入力前後で 2085 -> 4694 と、**表示時と完全に一致**した。使い捨ての計測スクリプトを書いて3条件（表示あり / 非表示・DOM レンダラ / 非表示・WebGL）を比べている
- **メモのスコープはユーザーに確認して決めた。** 全体のみ / セッションのみ / 両方の3案を提示し、両方を選択。「行き場のない走り書きの置き場」と「どのセッションの話か」の両方が要るため
- **設定 UI の有無もユーザーに確認した。** 今回足す設定（Webhook URL・サウンド選択）は `config.json` の手編集に耐えないという判断で、パネルを新設

### 教訓

- **「送信しました」の表示だけを見るテストは、何も送っていなくても緑になる。** S32 はローカルに HTTP サーバを立て、実際にリクエストが届くこと・本文が Slack は `text` / Discord は `content` の形であることまで見ている。**外部サービスとの連携は「呼び出し側の戻り値」ではなく「受け手に届いたもの」で検証する**
- **入力欄に文字が入っただけでは保存の検証にならない。** S29 / S30 はサイドバーのタブを切り替えて MemoPanel をアンマウントさせ、再マウント時の `memo:list` で取り直した値を見ている。React の state だけで完結していないことを担保するため
- **スクリーンショットは撮ったら必ず目視する。** 初回の S31 は「通知音を鳴らす」が無効（ハーネスの既定が `notifySound: false`）で、注釈を付けたサウンド欄が灰色の使えない欄に見えていた。キャプションが直下のボタンを覆ってもいた。**どちらもテストは green のまま**で、画像を開くまで気づかなかった
- **表示の都合で変わる class にテストを結び付けない。** 履歴行のボタンが1個から2個に増えたとき、`history-item__edit` -> `history-item__action` の改名で S27 / S28 が壊れた。`aria-label` に切り替えて、以後は表示の変更で壊れないようにした
- **着手時に Issue を切らなかったのは誤り。** 作業を始めてから Issue #5 を立て、それまでの記録を Issue #1 のワークスペースに書いてしまった（このファイルへ移設済み）。**今回作った `/workspace-plan loop` の「0. 復元」が想定している状態を、自分で崩した**。ループの最初のステップを飛ばすとこうなる、という実例

### 次に再開するとき最初に読むべきこと

1. ブランチは `feat/memo-notify-settings-dev-loop`、PR は [#6](https://github.com/Yoshinaga-iwnl/ai-terminal/pull/6)。base は `main`
2. 検証の状態: `make check` green（54 unit / typecheck 3構成 / lint）、`make e2e-headless` 32/32 green、`make e2e-lint` FAIL=0 WARN=0、`lint-skills` FAIL=0
3. **PR #6 は、未マージのまま残っていたコミット `3caf03c`（セッションタイトル編集）を巻き込んでいる。** これは PR #4 のマージ後に同じブランチへ積まれたもので、今回の変更が依存している。詳細は `known-issues.md` の 1 番
4. **`make e2e` を回すときはマシンの負荷を先に見ること。** 1回目の実行（6.7分）で S25 が flaky になったが、**テストの中身ではなく `beforeEach` の起動タイムアウト**。負荷が下がった状態の再実行（2.9分）では 32/32 green。Issue #1 の worklog に同じ現象の記録がある
5. 残っている手動確認は `known-issues.md` の 2 番（通知音が実際に鳴ること）
6. **開発ループの入口が `/workspace-plan loop` になった。** 実装を伴う依頼は既定でここを通す。`status` で復元し `update` で記録するので、この worklog を読むところから始まる

---

<!-- 以降、作業のたびにセクションを追記 -->
