# Worklog

時系列の作業ログ。**設計判断の根拠**と**学んだ教訓**を中心に記録する。
コード差分は git log を参照、現状の構造は `architecture.md` を参照。

---

## 2026-07-29 - screenReaderMode の追加と VoiceOver の自動検知

### 実施内容

- `src/main/accessibility.ts` を新設し、`app.accessibilitySupportEnabled` の取得と `accessibility-support-changed` の push を実装した
- `AppConfig.screenReaderMode`（既定 false）を追加し、`config.ts` の既定値と `coerceConfig` を追従させた
- `App.tsx` で実効値を `config.screenReaderMode || accessibilitySupport` として `TerminalPane` へ渡した
- `useTerminal.ts` の **Terminal 生成時と反映 effect の両方**に入れた
- 設定パネルに「アクセシビリティ」節を新設した（既存の「動作」節はゴミ箱化しているため足さない）
- E2E `S37` を追加し、`scenarios.yml` にも追記した
- 既定値が false であることを `test/unit/config.test.ts` で固定した
- 検証: `make check`（unit 65）/ `make e2e`（37 passed）/ `make e2e-lint`（PASS=272 FAIL=0）
- **`useTerminal.ts` の配線2箇所を外してビルドし、S37 が `Expected: 1 / Received: 0` で赤くなることを確認した**

### 設計判断

判断の一覧と根拠は `architecture.md` の設計判断履歴が正。要点だけ:

- **設定（明示）と OS 検知（自動）の OR を実効値にした。** 設定だけでは、その設定の存在を知らないユーザーには永久に届かない
- **E2E で無効時と有効時の両方を見た。** 有効時だけ見ると「常に出ている」場合も緑になり、設定が効いていることを何も担保しない

### 教訓（該当する場合）

- **「有効にしたら出る」だけを見るテストは、何も検証していないことがある。**
  S37 は1つのシナリオの中で2回アプリを起動し、既定（要素が無い）と有効（要素がある）を比較している。
  片側だけだと、実装が常に有効でも緑になる
- **xterm のオプションは生成時と反映 effect の両方に入れる。** 生成時だけだと設定変更が既存タブに効かず、
  反映 effect だけだと起動直後に効かない。fontSize / theme が既にこの形になっていたので、それに揃えた
- 鉄則2（PTY の出力を加工しない）は、この機能を**入れない理由ではなく入れる理由**だった。
  自前でアクセシビリティバッファを実装せずに済む唯一の手段が xterm 側のこのオプション。
  非目標の書き方が雑だと、こういう「やらない理由」の誤読が生まれる

### 次に再開するとき最初に読むべきこと

- **Issue #23 の実装・検証・文書更新は完了。** 残りは commit / push / PR
- **実機の VoiceOver での確認が残っている**（`known-issues.md` の1番）。とくに `claude` の TUI で
  読み上げが実用になるかは実測しないと分からない。**実用にならないなら、その事実を README に書く**
- 次に着手するのは「既知 status の共通化 -> #24（Dock バッジ・通知クリック）」。
  `issue-21/known-issues.md` の1番が前提で、**#24 で判定が3箇所目になる**
- **`main` の履歴がルートから書き換えられた事故があった**（PR #26 / #28 が自動的に閉じ、#29 / #30 として作り直した）。
  ブランチを切ったら `git log --oneline -1` と `git status` の両方を必ず確認する

---

<!-- 以降、作業のたびにセクションを追記 -->
