# Issue #5 メモ・Slack/Discord 通知・サウンド設定・設定パネルと、開発ループ skill の追加 - Overview

> **Issue**: [#5 メモ・Slack/Discord 通知・サウンド設定・設定パネルと、開発ループ skill の追加](https://github.com/Yoshinaga-iwnl/ai-terminal/issues/5)
>
> MVP と E2E 基盤（#1）が揃った上に、「エージェントに任せている間の体験」を足す。エージェントの作業中に書き留める場所（メモ）、席を外していても気づける導線（Slack / Discord 転送・通知音）、それらを設定するための UI、そして実装の進め方そのものを定義する開発ループ skill。
>
> 詳細は以下の3ドキュメントに分割:
>
> - `architecture.md` - 触る構造・Contract変更・設計判断
> - `worklog.md` - 時系列の作業ログ・次に再開するとき最初に読むべきこと
> - `known-issues.md` - 判明した問題・未解決事項・先送りしたもの
>
> **最終更新**: 2026-07-28

---

## 1. ゴール

エージェントに任せている間の体験を埋める4機能（メモ / 通知転送 / サウンド / 設定パネル）を実装し、あわせて**その実装の進め方自体を skill として固定する**。テストは E2E 一層だけだったところに単体テスト層を足し、開発ループの「検証」段が実体を持つようにする。

| カテゴリ | 対象 |
|---|---|
| 対象トラック | main（memo / notify）+ renderer（メモパネル・設定パネル）の2トラック |
| ブランチ | `feat/memo-notify-settings-dev-loop` |
| 関連PR | [#6](https://github.com/Yoshinaga-iwnl/ai-terminal/pull/6) |

---

## 2. 完成条件

- [x] メモ（全体 / セッション）を書いて保存でき、アプリを操作し直しても残る -> E2E S29 / S30
- [x] Slack / Discord にタスク完了通知が届き、設定画面のテスト送信で事前に確認できる -> E2E S32
- [x] 通知音を選んで試聴でき、存在しない音源を指定しても通知自体は出る
- [x] 設定パネルから変更した内容が即座にアプリへ反映される -> E2E S31
- [x] 単体テスト層が存在し、`make check` の一部として回る -> `test/unit/` 54 ケース
- [x] 新機能に対応する E2E シナリオが追加され、`make e2e-lint` が FAIL=0 -> S29〜S32、全32シナリオ
- [x] ウィンドウ非表示で全 E2E シナリオが green になり、その結果が記録されている -> `make e2e` 32/32（ウィンドウ非表示が既定）
- [x] 開発ループの手順が skill として存在し、`lint-skills.sh` が FAIL=0 -> `/workspace-plan loop`
- [x] README に新機能の使い方が載っている
- [x] 型チェック通過（`make check`）
- [x] Lintチェック通過（`make check`）

---

## 3. 現状進捗

| 項目 | 状態 |
|---|---|
| 設計 | 完了 |
| 実装 | 完了 |
| 検証 | 完了（`make check` 63件 / `make e2e` 33/33・29.6 秒 / `make e2e-lint` FAIL=0 / `lint-skills` FAIL=0） |

---

## 4. 直近の次アクション

**残タスクは GitHub Issue に起票済み。** 状態の唯一の正は Issue 側で、ここは索引に留める。

| Issue | 優先度 | アクション |
|---|---|---|
| （PR #19） | **P0** | PR [#19](https://github.com/i-iwnl/ai-terminal/pull/19) のレビューとマージ。**PR #6 は 2026-07-28 にマージ済み**（`known-issues.md` の 1 番は解消） |
| [#7](https://github.com/Yoshinaga-iwnl/ai-terminal/issues/7) | P2 | 実機の IME で日本語入力を確認する（`manual-only`。**ユーザーにしかできない**） |
| [#9](https://github.com/Yoshinaga-iwnl/ai-terminal/issues/9) | P2 | 通知音が実際に鳴ることを手動で確認する（`manual-only`。**ユーザーにしかできない**） |
| [#13](https://github.com/Yoshinaga-iwnl/ai-terminal/issues/13) | P2 | Webhook URL を safeStorage へ移す（`deferred`） |
| [#15](https://github.com/Yoshinaga-iwnl/ai-terminal/issues/15) | P3 | tmux 永続化の検証手段が無い（`deferred`） |
| [#16](https://github.com/Yoshinaga-iwnl/ai-terminal/issues/16) | P3 | macOS 通知の発火を検証する手段が無い（`deferred`） |

**2026-07-28 に #8 / #10 / #11 / #12 / #14 を対処し、2026-07-29 に cwd 絞り込みの不具合を直した**
（詳細は `worklog.md` の各エントリ）。いずれも PR #19 に入っている。
手を動かせる残 Issue は無く、残りは `manual-only` と `deferred` のみ。

今周で `known-issues.md` に追加した2件は起票済み:
[#17](https://github.com/Yoshinaga-iwnl/ai-terminal/issues/17)（Electron の起動が稀にウィンドウを出さない / P3）と
[#18](https://github.com/Yoshinaga-iwnl/ai-terminal/issues/18)（撮影ハーネスの DOM 加工が対象の状態を壊しうる / P3・`deferred`）。

Issue #1 側の残タスクは [#7](https://github.com/Yoshinaga-iwnl/ai-terminal/issues/7) / [#15](https://github.com/Yoshinaga-iwnl/ai-terminal/issues/15) / [#16](https://github.com/Yoshinaga-iwnl/ai-terminal/issues/16)（[#8](https://github.com/Yoshinaga-iwnl/ai-terminal/issues/8) は 2026-07-28 に対処済み）。
