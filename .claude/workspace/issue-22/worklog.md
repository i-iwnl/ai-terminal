# Worklog

時系列の作業ログ。**設計判断の根拠**と**学んだ教訓**を中心に記録する。
コード差分は git log を参照、現状の構造は `architecture.md` を参照。

---

## 2026-07-29 - アプリケーションメニューの新設

### 実施内容

- `src/main/menu.ts` を新設し、`src/main/index.ts` から登録した（`activate` での再生成時にも張り直す）
- `src/shared/ipc.ts` に `AppAction` / `IpcEvent.menuAction` / `RendererApi.menu` を追加した
- `App.tsx` の switch を `runAction()` に切り出し、キーボードとメニューの両方から呼ぶ形にした
- `Cmd+K` を「画面を消去」に変え、AI CLI の起動を `Cmd+Shift+C` / `Cmd+Shift+G` に移した
- `TerminalHandle.clear()` を追加した（xterm の `clear()` を呼ぶだけ。PTY には触らない）
- E2E `S36` を追加し、`scenarios.yml` にも追記した（check2 が要求する）。**check7 が「1 spec = 1 シナリオ」を強制する**ため、当初2本に分けていた test を1本にまとめた
- 既存 E2E 4本（S09 / S10 / S11 / S15）と `screenshots.spec.ts` のキー押下を追従させた
- `README.md` のショートカット表を書き直し、`docs/images/S09-launch-claude.png` を撮り直した
- 検証: `make check`（unit 64）/ `make e2e`（36 tests、S27 が1回 flaky）/ `make e2e-lint`（PASS=265 FAIL=0）
- **メニュー登録をコメントアウトしてビルドし、S36 が赤くなることを確認した**

### 設計判断

判断の一覧と根拠は `architecture.md` の設計判断履歴が正。要点だけ:

- **キーの登録は Renderer に一本化し、メニューの accelerator は表示専用にした**（`registerAccelerator: false`）。
  発見可能性と単一の発火経路を両立できるのがこの形だけ
- `ShortcutAction` を `src/shared/ipc.ts` の `AppAction` に移した。メニューとキーボードは
  同じ操作の別の入口なので、語彙が分かれると片方にだけ操作が増える

### 教訓（該当する場合）

- **検査したい性質が「読めない値」に依存しているなら、その検査は書かない。**
  最初 `MenuItem.registerAccelerator` を assert しようとしたが、インスタンスからは読めず
  **46項目すべてが「登録済み」と判定された**。そのまま「期待どおり全部 false」に見える形へ
  書き換えることもできたが、それは何も見ていないテストになる。書かずに、
  検出できないことを `known-issues.md` に明記する方を選んだ
- **E2E の合成キーはネイティブメニューを通らない。** だから「メニューのキーを押す」テストは書けない。
  一方で **メニュー項目の `click()` を Main プロセス側から直接呼ぶことはできる**ので、
  menu -> IPC -> preload -> Renderer の経路はそちらで担保した
- ネイティブメニューは `electronApp.evaluate()`（Main プロセス内で実行される）から読める。
  Renderer からは見えないので、この経路を知らないと「メニューは E2E で検証不能」と誤って諦める
- **`git switch` がブランチを切り替えても、作業ツリーが戻っているとは限らない。**
  #21 のブランチから main へ切り替えたつもりで #22 に着手したが、実際には #21 の変更が
  未コミットのまま混ざり、ローカルのブランチポインタも壊れていた（リモートは正常）。
  ブランチを切ったら **`git log --oneline -1` と `git status` の両方**を見て、
  HEAD と作業ツリーが期待どおりかを確認してから着手する
- 結果として #22 は #21 の上に積む形にした。**画像12枚が両方の周で撮り直されるため、
  独立させるとマージ時に必ず衝突する。** 見た目に関わる周が連続するときは、
  最初から積むほうが安い

### 次に再開するとき最初に読むべきこと

- **Issue #22 の実装・検証・文書更新は完了。** 残りは commit / push / PR
- **実機での確認が1つ残っている**: `make build` した成果物で `Cmd+T` が1枚しか開かないこと、
  `Cmd+R` で画面が消えないこと。`known-issues.md` の1番。**E2E では検出できないので省略しない**
- 次に着手するのは #23（screenReaderMode）。独立しているのでこの PR の完了を待たなくてよい
- その次は「既知 status の共通化 -> #24」。`issue-21/known-issues.md` の1番が前提

---

<!-- 以降、作業のたびにセクションを追記 -->
