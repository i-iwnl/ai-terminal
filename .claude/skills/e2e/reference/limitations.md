# 自動テストで担保できないもの

この E2E 基盤（Playwright + 隔離ハーネス）が届く範囲には限界がある。「自動化できていないから未検証」ではなく、代替手段とセットで扱う。

**限界には2段ある。混ぜないこと。**

| 段 | 誰が確かめるか |
|---|---|
| **E2E に写らないが、Renderer の中にはある**（ホバー中の見た目・計算後のスタイル・実寸・永続化） | **エージェントが agent-browser で確かめられる** -> [../operations/verify-on-device.md](../operations/verify-on-device.md) |
| **Renderer の外にある**（OS の支援技術・OS 通知・Finder・Dock・ネイティブメニュー・別プロセス） | **人間しか確かめられない**。このファイルの以降の節が手順書 |

このファイルが扱うのは**下の段**。上の段を「自動化できない」と書かないこと（agent-browser で届く）。

## 対象外の項目と代替手段

| 対象外 | 理由 | 代替手段 |
|---|---|---|
| macOS の実 IME（ことえり等）との相互作用 | Playwright は Chromium の DevTools Protocol（`Input.imeSetComposition`）で変換中状態を作れるが、これは xterm.js 側の composition 処理を通すだけで、OS の入力メソッドそのものは動かしていない | S22（[../../../../e2e/specs/S22-ime-composition.spec.ts](../../../../e2e/specs/S22-ime-composition.spec.ts)）が xterm.js 側の経路までを担保する。OS レベルの確認は [/terminal](../../terminal/SKILL.md) の [operations/verify-terminal.md](../../terminal/operations/verify-terminal.md) にある手動チェックリストで行う |
| vim / htop の描画品質 | 崩れているかどうかの判定は人間の目に依存し、機械的な合否基準を作れない | E2E では起動できること・アプリがクラッシュしないことのみを検証する。見た目の崩れは手動確認に委ねる |
| macOS 通知 | Playwright から OS 通知の表示を検証する手段が無い | 検証手段なし（既知の限界として扱う） |
| 通知音が実際に鳴ること | `afplay` の起動は投げっぱなしで、音が出たかを観測する手段が無い | 音源パスの解決規則は `test/unit/` の対象。「鳴らす操作でアプリが落ちない」ことまでが E2E の範囲 |
| Slack / Discord の実サービスへの到達 | 実 Webhook を叩くとテストが外部サービスとネットワークに依存し、URL の秘匿も必要になる | S32（[../../../../e2e/specs/S32-webhook-notify.spec.ts](../../../../e2e/specs/S32-webhook-notify.spec.ts)）がローカルに HTTP サーバを立て、リクエストが届くこととペイロードの形（Slack は `text` / Discord は `content`）を検証する。実サービス側の受理は範囲外 |
| **Finder からの実ドラッグ（`dataTransfer.files` 経路）** | `webUtils.getPathForFile()` は Chromium が**実ファイルに対して発行した `File`** にしかパスを返さない。合成 `DataTransfer` では常に空文字になる | S42 が担保するのは `text/uri-list` 経路だけ。**`files` 経路は手動確認**（下記） |
| **ペイン外へ落としたときの画面遷移の抑止** | 合成 `DragEvent` ではブラウザ既定のナビゲーションがそもそも起きないため、`main.tsx` の `preventDefault()` を消しても E2E は全部 green =**常に成功するテスト**にしかならない | **手動確認のみ**（下記）。壊れるとファイルを落としただけで白画面になり、全タブと PTY を失う |
| tmux セッションの永続化 | アプリ再起動を跨ぐ挙動であり、1回のテストプロセス内で完結する E2E の前提を超える | 範囲外。tmux 経路を止めているのは `e2e/fixtures/harness.ts` の `useTmux: false` の1行だけ（`src/main/shell-path.ts` がログインシェルの PATH を Main プロセスの `process.env.PATH` にマージするため、tmux が入った開発機では `isTmuxAvailable()`（中身は `spawnSync('which', ['tmux'])` だけ）は true を返す。この1行を指定しなければ経路に入ってしまう） |
| `ownedByApp` が true になる肯定側のケース | 偽 CLI が返す `agents --json` の固定データは、アプリが起動時に採番する UUID（`crypto.randomUUID()`）を含められなかった | 否定側（無関係な固定タスクが誤って owned 扱いにならないこと）のみを S15（[../../../../e2e/specs/S15-task-owned.spec.ts](../../../../e2e/specs/S15-task-owned.spec.ts)）で検証している。**解消済み**（Issue #120 D-2 の `setAgentEntries()` + #121）。偽 claude が出す `ARGS: --session-id <uuid>` を spec が読んで `agents.json` へ書き戻す形で、**肯定側も検証済み** — [S15](../../../../e2e/specs/S15-task-owned.spec.ts) の「ここから肯定側」以降が、`.task-item--owned` 1件・バッジ「このアプリ」・行が `BUTTON` になることまで見ている。⛔ **この行を「未実装」と読まないこと** |

## tmux 経路の担保範囲（Issue #121 C-3 の結論。2026-08-03）

**「E2E では tmux 経路を踏めない」は誤りだった。** ハーネスは PATH の先頭に一時 HOME 配下の
`bin` を置いており、そこへ**偽 tmux**（`e2e/fixtures/bin/tmux`）を置けば
`isTmuxAvailable()`（中身は `spawnSync('which', ['tmux'])` だけ）が true になり、
`config: { useTmux: true }` の経路を決定的に踏める。**S84 がこれを使っている**
（`launchApp({ config: { useTmux: true }, fakeTmux: true })`。既定は `fakeTmux: false` なので
既存シナリオの挙動は1つも変わらない）。

| 担保できる | 担保できない |
|---|---|
| `maybeWrapWithTmux` が実際にラップし、`wrappedInTmux` が Main -> Renderer -> `PaneLeaf` -> 画面まで届くこと | **代替画面バッファへの切り替え**（本物は `ESC [ ? 1049 h` を出す）。偽 tmux は `exec` するだけ |
| tmux ラップの有無で画面（検索バーの注記）が出し分かること | **セッションの永続化**（アプリ再起動を跨いで `-A` で再アタッチできること） |
| `-- ` 以降がそのまま子プロセスへ渡ること（セッション名を書き出して裏取りする） | **タブを閉じても中のプロセスが生き残ること**（偽 tmux の子は親と運命を共にする） |

### 本物の tmux による自動検証は作らない（判断）

**理由は「重いから」ではなく、隔離が原理的に効かないから。**

E2E の隔離は**一時 HOME**で成り立っている。しかし tmux のサーバは
`/private/tmp/tmux-<uid>/default` という**ソケット1本にぶら下がるプロセス横断の資源**で、
HOME を差し替えても分離されない。ここで自動テストを回すと:

- **テストが落ちた・中断したときに、実物の `claude` / `gemini` が起動したまま残る**
  （実測: タブを閉じてもセッションと `claude --session-id … (Ss+)` が生き残る）
- しかも **gemini は名前を再現できないので回収手段が無い**（`src/main/pty/tmux.ts`）
- 開発者のマシンで**別の作業中の tmux セッションと同居する**ため、
  `kill-server` による後片付けも安全に打てない

**テストが失敗したときに、開発者のマシンに実プロセスを置き去りにする検証は作らない。**

### 代わりに何で担保するか

**人手で測って、結果を日付とバージョン付きで書き残す。** 機械で検出できない範囲なので、
「いつ・何で確認したか」が唯一の担保になる（ファイルの D&D と同じ扱い）。

**最終確認: 2026-08-03（tmux 3.7b。Issue #121 周2）。** 測った内容と結果は
[/terminal](../../terminal/SKILL.md) の
[reference/pty-pitfalls.md](../../terminal/reference/pty-pitfalls.md)
「tmux でラップしたセッションは、タブを閉じても生き残る」が正。
**そこに書いてある3点（内側終了時は `onExit` が発火する / タブを閉じるとセッションと
プロセスが生き残る / claude と gemini の非対称）は、すべてこの日の実測。**

`src/main/pty/tmux.ts` の起動形（`tmux new-session -A -s <name> -- <cmd>`）を変える
変更をしたら、**この3点を測り直してここの日付を更新すること。**

## ファイルの D&D の手動確認（Issue #120 D-3）

上の2行は**合成イベントでは原理的に検証できない**ので、人手で確認して結果をここに記録する。

| # | 操作 | 期待する結果 |
|---|---|---|
| 1 | Finder からファイルを1つペインへドロップ | 絶対パスが挿入される（実行はされない） |
| 2 | **名前に空白を含むフォルダ**の中のファイルをドロップし、先頭に `ls ` を付けて実行 | エラーにならず中身が出る（= クォート／エスケープが正しい） |
| 3 | ファイルを複数まとめてドロップ | スペース区切りで並ぶ |
| 4 | **サイドバーとタブバー**にファイルを落とす | **画面が変わらない**（白画面にならない） |

**最終確認: 2026-08-03（Issue #120 周6）。4項目とも期待どおり。**

**4 が最重要。** ここが壊れると全タブと PTY を失うが、自動テストは常に green を返す。
`main.tsx` の window レベルの `preventDefault()` に触る変更をしたら、必ずこの4項目を回すこと。

## OS のシステム設定に依存する確認（実施済み）

**エージェントは OS のシステム設定に到達できない。** agent-browser（CDP）も
Playwright の `emulateMedia()` も、**アプリ側に「そう見せる」だけ**で、
OS 設定がその分岐に届くかは別の事実。

### 「コントラストを上げる」が `@media (prefers-contrast: more)` に到達するか

| 実施日 | 結果 |
|---|---|
| **2026-08-05** | **到達する。** システム設定 > アクセシビリティ > ディスプレイ > 「コントラストを上げる」を入れると、**タブバーの配色が実際に変わる**ことをユーザーが実機で確認した |

**なぜ確認が要ったか。** S41（`S41-prefers-contrast.spec.ts`）が使うのは Playwright の
`emulateMedia({ contrast: 'more' })` で、これは **CSS の分岐が正しいことしか示さない**。
Electron / Chromium が macOS の `NSWorkspaceAccessibilityDisplayShouldIncreaseContrast` を
`prefers-contrast` に反映するかはバージョン依存で変わりうるため、
「`README.md` が『追従する』と断言しているが、誰も観測していない」という状態だった。

**偽だった場合の影響は大きかった** — `styles.css` の `@media` が上書きする11トークン
（#134 / #165 / #179 の周2・周2.5 でかけた作業ぶん）が、誰にも届いていないことになっていた。
**真だったので、それらはすべて実際に効いている。**

**個々のトークンが正しい値かは引き続き S41 の担当。** ここで確定したのは
「OS 設定 -> `@media` の分岐が到達する」という**経路の存在**だけ。

## フルスクリーン遷移そのものは E2E から強制できない（S79）

`win.setFullScreen(true)` は **AppKit へ要求を出すだけ**で、Space を作って遷移するかは
WindowServer 側の状態に依存する。**遷移しなければ `enter-full-screen` は発火せず、
Renderer に `is-fullscreen` は永久に付かない。** これはアプリのコードの外側にある。

### 実測（同一コミット・同一マシン）

| 日 | 結果 |
|---|---|
| 2026-08-04 | **落ちる。** `main` に戻して再ビルドしても同じ箇所で落ち、リトライでも再現した（flaky ではない） |
| **2026-08-05** | **落ちない。** フル `make e2e` 1回 + S79 単体 **10回連続**、すべて green（11/11） |

コードは1行も変わっていない（間の差分は `.claude/` と `docs/` だけ）。**再現条件は未特定**で、
別アプリのフルスクリーン・「ディスプレイごとに個別の操作スペース」・アニメーションの抑制などが
疑わしい。特定には OS 側の状態を人が作る必要があるため [#195](https://github.com/i-iwnl/ai-terminal/issues/195) の A-5 に置いた。

### 対策は「赤の主語を分ける」ことにした（2026-08-05）

**実害は落ちること自体ではなく、赤の主語が読めないこと**だった。2026-08-04 は
「関門が赤いのが常態」のまま PR を3本通し、`main` へ戻して再ビルドする切り分けまでやっている。

S79 は OS 側（`win.isFullScreen()`）とアプリ側（`.app` のクラス）を**別々に待つ**。

- OS 側で止まったら「macOS がフルスクリーン遷移を行わなかった。アプリの回帰ではなく環境要因」
- アプリ側で止まったら「Main は遷移したのに Renderer に届いていない = アプリの回帰」

**両方のメッセージが実際に出ることを確認済み**（前者は `BrowserWindow.prototype.setFullScreen` を
no-op に差し替えて、後者は `win.on('enter-full-screen')` の送信を落として再ビルドして実測）。

⛔ **`test.skip()` にはしない。** 環境要因でも赤は赤のまま出す。飛ばすと、
`enter-full-screen` の経路が壊れた日に**誰も気づかない**（部分一致の関門が恒真化するのと同じ形）。

## 実機確認の手順書（元 Issue #148 / #151 / #154 -> 現 #195 の A-1 / A-2 / A-3）

> **2026-08-05: この3件は [#195](https://github.com/i-iwnl/ai-terminal/issues/195) に集約した。**
> 元 Issue は「エージェント側の作業が尽きた」として close 済みで、**残作業の唯一の正は #195**。
> 手順そのものは以下がそのまま使える。

**この3件はコードの追加を伴わない。** どれも「実装は済んでいるが、実機でしか
確かめられない経路が一度も確かめられていない」という状態で、
**手順を書いて人が実施し、結果を日付つきでここへ書き戻す**ところまでが完了条件。

**なぜ自動化しないのか**は3件とも理由が違う。混ぜないこと。

| # | 対象 | 自動化できない理由 |
|---|---|---|
| #148 | VoiceOver の読み上げ品質 | **OS の支援技術を起動する必要がある。** E2E が担保できるのは「読み上げ対象の DOM（`.xterm-accessibility`）が存在し、出力がテキストとして入っている」まで（S37）。実際に読まれるか・TUI の再描画で実用になるかは別 |
| #151 | OS 通知のクリック | **通知はアプリの外にある。** Electron / Playwright のどちらからも押せない。Renderer 側の受け口は S63 が `session:focus` を直接送って担保済みで、**未検証なのは Main 側の前半**（`notify/index.ts` の `onClick` 配線と `poller.ts` の `focusSession()`） |
| #154 | tmux で閉じたタブへ resume で戻る | **隔離が原理的に効かない。** tmux サーバは `/private/tmp/tmux-<uid>/default` というプロセス横断の資源で、一時 HOME では分離できない。テストが落ちると実物の `claude` が開発機に残る（この判断の詳細は上の「本物の tmux による自動検証は作らない」） |

いずれも **`make install-app` した成果物**（`make dev` ではない）で実施する。
開発起動はメニューの中身が違い（`isDev()` の分岐）、PTY も再起動のたびに切れる。

### #148 VoiceOver の読み上げ

**設定は要らない。** `App.tsx` は `config.screenReaderMode || accessibilitySupport` を
実効値にしているので、**VoiceOver が動いていれば自動で有効になる**。
渡す先は**アクティブな1ペインだけ**（分割時に assertive な live region が N 個
並ぶ問題は #56 で手当て済み）。

| # | 操作 | 見るもの |
|---|---|---|
| 1 | VoiceOver を起動（`Cmd+F5`）してからアプリを前に出す | — |
| 2 | シェルのタブで `ls` を実行 | 出力が読み上げられるか |
| 3 | `seq 1 200` のように**速く大量に**出す | xterm は速すぎる出力で読み上げを打ち切る（`tooMuchOutput`）。**どこで打ち切られるか** |
| 4 | `Cmd+Shift+C` で claude を起動し、TUI が再描画している最中に聞く | **部分再描画がどう読まれるか。ここが実用の分かれ目** |
| 5 | `Cmd+D` で分割し、非アクティブなペインで出力を出す | 読み上げが二重にならないこと（露出している assertive は常に1個） |
| 6 | タブを切り替える | 読み上げ対象が付け替わること |

**TUI の再描画で実用にならないなら、その事実を `README.md` に書くこと**（#148 の完了条件）。
**期待させないことも設計。** 「読み上げに対応しています」とだけ書いて実際は使えない、が最悪。

### #151 OS 通知のクリック

`claude` の作業が終わると `poller.ts` が OS 通知を出し、クリックすると
`focusSession()` が `restore()` -> `show()` -> `focus()` の3手でウィンドウを前に出し、
Renderer へ `session:focus` を送る。**壊れ方は1つしかない** —
`targetWindow` が未設定・破棄済みだと**黙って return する**（通知は出たがウィンドウが前に出ない）。

| # | 状態 | 見るもの |
|---|---|---|
| 1 | ウィンドウが別アプリの裏 | 通知をクリック -> ウィンドウが前に出て、該当タブがアクティブになる |
| 2 | ウィンドウを**最小化**している | `restore()` が効いているか（1と違う経路） |
| 3 | 別アプリを**フルスクリーン**にしている | Space をまたいで前に出るか |
| 4 | 該当セッションが**分割中の非アクティブ側**のペインで動いている | **ペインまで着地する**か（タブ止まりでないこと。S63 が Renderer 側を担保している部分） |

### #154 tmux で閉じたタブへ resume で戻る

**設定の「アプリを閉じても AI の作業を続ける」を有効にしてから実施する。**

「名前が一致する」ところまでは `test/unit/pty-plan.test.ts` が固定している
（`buildClaudePlan()` -> `buildTmuxSessionName()` で新規起動と resume のセッション名が同じ）。
**未測定なのは「では実際に戻れるのか」**。

| # | 操作 | 見るもの |
|---|---|---|
| 1 | claude タブを開き、何か1往復させる（画面に見分けの付く出力を残す） | — |
| 2 | 別のターミナルで `tmux ls` | `aiterm-<uuid>` が居ること |
| 3 | タブを `Cmd+Option+W` で閉じる | **確認ダイアログが出る**（claude は「履歴から再開できます」と書かれる側） |
| 4 | `tmux ls` と `ps` | セッションと `claude --session-id <uuid>` が**生き残っている**こと |
| 5 | サイドバーの「履歴」から同じセッションを resume | **閉じる前の画面が戻るか**（新しい claude が起動していないか。手順1の出力が残っているかで判別する） |
| 6 | `tmux ls` | セッションが**増えていない**こと（`-A` でアタッチし直せた証拠） |

**戻れなかった場合、直すべきは実装だけではない。** `README.md`（「claude は履歴から
resume すれば同じプロセスに戻れる」）と `/terminal` の `reference/pty-pitfalls.md` が
**実測日の併記無しに断定している**ので、そちらも同時に訂正する。
加えて `src/renderer/src/tabs/closeTabCopy.ts` が claude について出している
「履歴から戻れるので確認で止めない」という判断の前提も崩れる。

### 実施記録

**最終確認: 未実施（3件とも）。**

実施したら、この節に**日付・macOS / tmux のバージョン・何を試して何が起きたか**を書く。
「実施した」だけでは、次に読む人が同じ確認をやり直すことになる
（上の tmux 節が `2026-08-03 / tmux 3.7b` と書いているのが手本）。

## Dock を弾ませる（`dock.bounce`）の手動確認（Issue #133）

**`app.dock.bounce()` が呼ばれたかを Playwright から観測する手段が無い。**
Electron に Dock の状態を読み戻す API が無く、`app.dock` 自体 macOS 専用。

### 機械で押さえている範囲

| 検査 | 見るもの |
|---|---|
| `test/unit/pty-exit.test.ts` | **いつ鳴らすかの判定**（`shouldBounceOnExit`）。「異常終了 かつ ウィンドウが前に無い」の AND、`signal: 0` を「シグナル無し」として扱うこと、Renderer の `severityForExit` と判定が一致すること |

**呼び出しそのもの（`app.dock.bounce('informational')` に到達するか）は手動でしか確認できない。**

### 人手で確認すること

`make dev` で起動し、**ウィンドウを別のアプリの裏に隠してから**次を行う。

| # | 操作 | 期待する結果 |
|---|---|---|
| 1 | シェルタブで `sleep 5 && exit 7` を打ち、別アプリへ切り替える | 5秒後に **Dock アイコンが1回跳ねる** |
| 2 | 同じく `sleep 5 && exit` （コード0） | **跳ねない**（正常終了では鳴らさない） |
| 3 | ウィンドウを前に出したまま `exit 7` | **跳ねない**（見ている最中に鳴らさない） |
| 4 | 別アプリを見ている間にタブを `Cmd+Option+W` で閉じる | **跳ねない**（アプリ side の kill は `entry` が先に消えるので通知経路に乗らない） |

**最終確認: 未実施**（`src/main/pty/manager.ts` の `proc.onExit` を触ったら回すこと）。

## メニューとキーボードの二重発火の手動確認（Issue #22 / #144）

メニュー項目の accelerator が `registerAccelerator: true`（既定）のままだと、
Main（ネイティブメニュー）と Renderer（`shortcuts.ts` の `matchShortcut`）が
**同じキーを両方拾い、1回の打鍵で2回発火する**（`Cmd+T` 一回でタブが2枚開く）。

**この経路は E2E では原理的に踏めない。**

- Playwright の `keyboard.press()` は Renderer に合成キーイベントを送るだけで、
  ネイティブメニューの accelerator 経路を通らない
- `MenuItem` インスタンスから `registerAccelerator` は読めない
  （実測で全項目 `undefined`。`item.accelerator && item.click` で拾った46項目すべてが
  「登録済み」と判定された）

### 機械で押さえている範囲（Issue #144）

| 検査 | 見るもの |
|---|---|
| `test/unit/menu-accelerators.test.ts` | `src/main/menu.ts` を**テキストとして**読み、`accelerator:` を直接書いた項目が `registerAccelerator: false` を伴うこと。`actionItem()` を通さない項目が許可リスト（現在「設定...」1件）から増減していないこと |
| `e2e/specs/S36-application-menu.spec.ts` | `role` 経由の亜種（`reload` / `forcereload` / `toggledevtools` / `zoomin` / `zoomout` / `resetzoom`）が1つも無いこと。**`role` が暗黙に持つ accelerator はソースに `accelerator:` の文字が現れないので、上の静的検査では拾えない** |

### 人手で確認すること

**`make install-app` した成果物で行う。`make dev` では確認にならない。**
`menu.ts` の `isDev()` が「表示」メニューに `role: 'reload'` / `role: 'toggleDevTools'` を
出し分けているので、**開発中に見ているメニューはユーザーが見るメニューと同じではない**
（Issue #145）。1回ずつ押して**1回だけ起きること**を見る。

| # | 操作 | 期待する結果 |
|---|---|---|
| 1 | `Cmd+T` を1回 | タブが**1枚だけ**増える |
| 2 | `Cmd+Shift+C` を1回 | claude タブが**1本だけ**開く |
| 3 | `Cmd+Shift+E` を1回 | gemini タブが**1本だけ**開く（**`Cmd+Shift+G` ではない。あちらは「前を検索」**） |
| 4 | `Cmd+D` を1回 | ペインが**1枚だけ**増える（2枚増えない） |
| 5 | `Cmd+-` / `Cmd+0` | **ターミナルの文字サイズだけ**が変わる（Renderer 全体の拡大率が変わらない。設定に保存され、再起動しても戻らない） |
| 6 | `Cmd+,` を1回 | 設定ウィンドウが**1枚だけ**開く |

**`Cmd+R` は本番メニューに存在しない**（S36 が不在を固定している）ので、確認項目に入れない。

**最終確認: 未実施**（`src/main/menu.ts` に accelerator 付き項目を足したら回すこと）。

### S36 をパッケージ版スモークに足さない（判断。Issue #145）

`e2e/packaged.playwright.config.ts` の `testMatch` に **S36 は足さない。**

**通常レーンが既に本番のメニューを見ているため。** `isDev()` の入力は
`ELECTRON_RENDERER_URL` の有無だけで、`e2e/fixtures/harness.ts` はこれを
空文字で渡す。**つまり `make e2e` の S36 は `role: 'reload'` を含まない側**
＝ユーザーが見るメニューを検証している。パッケージ版で追加できるのは
asar / 署名 / preload 解決の層だが、**メニュー構築はそのどれにも触れない**
（`Menu.getApplicationMenu()` のラベルと role を読むだけでファイルを開かない）。

スモーク4本（S01 / S09 / S12 / S39）は「**パッケージングでしか壊れない層**」
を狙って選んである（asar・asarUnpack した node-pty の spawn-helper・execFile・
ログインシェルの PATH 解決）。S36 はその条件を満たさないので、足すと
`make install-app` の関門が重くなるだけになる。

### ⚠ 逆に、**開発側の分岐は機械が一度も通らない**

`isDev()` が true のときだけ現れる `role: 'reload'` / `role: 'toggleDevTools'` は、
**`make e2e` でも `make e2e-packaged` でも実行されない**（どちらも
`ELECTRON_RENDERER_URL` を渡さないため）。この分岐を壊しても全レーンが green のまま
`make dev` で初めて気づくことになる。**メニューの dev 分岐を触ったら、`make dev` で
「表示」メニューを開いて目で見ること。**

## OS のフォーカスに依存する判定は E2E から踏めない（Issue #152）

`BrowserWindow.getFocusedWindow()` を見る経路は、**E2E では前提条件を作れない。**

| 測ったこと | 結果 |
|---|---|
| 設定ウィンドウを開いた状態の `getFocusedWindow()` | **`null`** |
| `settingsWin.focus()` を呼んだあと | **`null`** |
| `app.focus({ steal: true })` を挟んだあと | **`null`** |
| 各ウィンドウの `isFocused()` / `isVisible()` | **すべて `false`** |

**原因はハーネスの非表示化そのもの。** `e2e/fixtures/harness.ts` は
`BrowserWindow.prototype.focus` / `show` / `showInactive` / `moveTop` を **noop へ
差し替え**、全ウィンドウを `hide()` し `dock.hide()` している。開発者のエディタから
フォーカスを奪わないための意図的な設計で、**外すと E2E 全体の前提が変わる**
（テストの本数だけウィンドウが前に出る）。

**ここに検査を書くと恒真の関門になる。** 「設定にフォーカスがあるとき本体へ送らない」を
E2E で書いても、その前提を一度も踏まずに必ず通る。判定は純粋関数へ切り出して
`test/unit/menu-action-routing.test.ts` で固定した（`isSafeExternalUrl` /
`describeSpawnError` と同じ扱い）。

**通常起動の Electron では正しく追従することは実測済み**（`parent` 付き子ウィンドウが
生成時にフォーカスを取り、親の `focus()` で親へ戻る）。**実挙動の最終確認は人力**で、
ネイティブメニューをマウスで選ぶ必要があるため `agent-browser` でも代替できない
（`operations/verify-on-device.md` の「マウス操作はページに DOM イベントを届けない」）。
-> [#195](https://github.com/i-iwnl/ai-terminal/issues/195)

## ⚠ 「E2E から見えない」と書いてあっても、まず自分で測る（2件が誤りだった）

**このファイルの記述もコードのコメントも古くなる。** 2026-08-05〜06 の周で、
「見えない」と信じられていたものが**2件とも実は見えた**。どちらも、そのまま従っていたら
本物の関門を1本ずつ落としていた。

| 「見えない」とされていた | 実際 | 何が違ったか |
|---|---|---|
| **ウィンドウ状態の保存・復元**（`test/unit/window-state.test.ts` の冒頭が「E2E でもプロセスを跨げないので検証できない」と明記していた） | **設定ウィンドウは見える**（`S98`） | **本体ウィンドウ**は復元にアプリの再起動が要るので確かに見えない。**設定ウィンドウは開くたびに `new BrowserWindow`** なので、同じプロセスの中で「動かす -> 閉じる -> 開き直す」を通せる |
| **支援技術を検知した状態**（VoiceOver が要ると思われていた） | **`app.evaluate` から作れる**（`S99` / `S100`） | `app.accessibilitySupportEnabled = true` を**代入できる**（例外なし）。**`accessibility-support-changed` も実際に発火し**、preload 経由の `invoke` も `true` を返す |

**見分け方**: 「復元に**プロセスの再起動**が要るか」「その状態を作る API が **Main 側にあるか**」。
どちらも E2E の中で作れるなら、それは制約ではない。

⚠ **隠したウィンドウでも `setBounds()` は効く**（`getBounds()` / `getNormalBounds()` に反映される）。
ただし **`resize` は飛ぶが `move` は飛ばない**（実測。macOS）。**ドラッグでの移動が保存されることは
E2E では担保できない**ので、両方のイベントを購読する実装なら片方は無検査だと明記して残す。

## かつて盲点だったもの（S23 で塞いだ）

**描画そのもの。** 既定では全シナリオを `--disable-gpu` で起動するため、以前は DOM レンダラ経路しか通っていなかった。DOM レンダラは文字を実 DOM のテキストノードとして描くので、`xterm.css` の読み込みを忘れていても表示されてしまう。実際にその不具合を全22シナリオ green（当時） のまま見逃し、ユーザーが使う `make dev`（WebGL レンダラ）ではターミナルが真っ黒だった。

現在は S23（[../../../../e2e/specs/S23-webgl-rendering.spec.ts](../../../../e2e/specs/S23-webgl-rendering.spec.ts)）が GPU を有効にしてピクセルを数え、実際に描画されていることを検証する。

**教訓として残すこと: テスト容易性のための設定は、そのまま検証の盲点になる。** `--disable-gpu` は「canvas だと DOM から文字が読めない」という正当な理由で入れたもので、判断自体は誤っていない。誤っていたのは、その裏返しとして何が検証されなくなるかを書き残さなかったこと。同種の設定を足すときは、**それによって通らなくなる経路をこのファイルに書くこと。**

## かつて盲点だったもの（S40 / S41 で塞いだ）

**配色そのもの。** 色をアサートしている spec は数本しかなく、しかも据え置く値や spec 独自の値を見ていたため、
**`--text-tertiary` を `#000000` にしてもフル実行が green になった**。`docs/images/` は存在しか検査されないので、そちらでも止まらない。
配色の値を変える作業（Issue #20 の Phase 1）に、良し悪しを判定する関門が1つも無かった。

いま塞いでいるもの:

| spec | 型 | 守るもの |
|---|---|---|
| S40 | **characterization**（期待値は「あるべき値」ではなく「いまそうなっている値」） | 代表要素のコントラスト比。既定の配色が黙って動かない |
| S41 | 前後比較 | `emulateMedia({ contrast: 'more' })` で実際に上がること |

**characterization を選んだ理由**: 現状は WCAG を満たしていない箇所が残っており、閾値で assert すると最初から赤くなって使えない。
実測値を固定しておけば、**値を変える PR の diff に `3.51 -> 4.67` が現れてレビュー資料になる**。是正が全部終わったら閾値 assert に切り替える。

この型を書くときの落とし穴（どれも実際に踏んだ）:

- **測れなかった項目を「合格」にしない。** 測定結果のキー集合と期待値のキー集合の一致を先に検査する。
  セレクタが変わって要素が見つからないとき、静かに素通りするのが最悪の壊れ方
  （実際、起動直後はタブが1枚しかなく「非選択タブ」が測れていなかったのをこれが捕まえた）
- **測る順序が結果を変える。** フォーカスを当ててから枠を測ると、`:focus` が `border-color` を変えるので
  「通常の枠」ではない値が出る。**通常状態を測り終えてからフォーカスする**
- **宣言値ではなく実効色を測る。** `getComputedStyle` で解決し、背景は**透明でない最初の祖先まで遡る**
  （ボタンの多くは `background: transparent` なので、自分の背景を読むと透明が返る）。
  この「何を背景と見なすか」を紙の上で決めようとして、**3回続けて誤った**

## ベース設定に `projects` を足すと、それを spread している別レーンが黙って壊れる

**`make install-app` が 2026-08-04 まで壊れていた。** 症状は
`npx playwright test --config=e2e/packaged.playwright.config.ts` が
**`No tests found`** で落ちること。

原因は Playwright の優先順位。`packaged.playwright.config.ts` は
`{ ...baseConfig, testDir: './specs', testMatch: [...4本] }` の形で書かれていたが、

- Issue #120 周5（PR #125）が撮影レーンを取り込むため、**ベース設定に `projects` を足した**
- **`projects` があると、トップレベルの `testDir` / `testMatch` は無視される**
  （各 project の指定が優先される）
- ベース側の project の `testDir: './e2e/specs'` が、この設定ファイル基準
  （`e2e/`）で解決されて **`e2e/e2e/specs`** になり、存在しないので 0 件

**PR #125 から気づかれるまで、この関門は一度も動いていなかった。**
`make e2e-packaged` は `install-app` からしか回らず、`make e2e` にも
`make check` にも入っていないため、**踏むまで分からない経路**だった。

対策として `packaged.playwright.config.ts` は `projects` を明示的に外している。

**一般化: 設定を spread で継承しているレーンがあるとき、継承元にキーを足す変更は
継承先の意味を変える。** 特に Playwright の `projects` は
「あると他の指定を無効化する」種類のキーなので、足すときは
`grep -l "baseConfig\|playwright.config" e2e/*.ts` で継承先を数えること。

## 本番忠実度の階段と、自動化の天井（Issue #40 / #42）

E2E には「本番にどこまで近いか」の段階があり、レーンを分けている。

| レーン | 起動するもの | 検証できる層 | 実行タイミング |
|---|---|---|---|
| `make e2e` | node_modules の electron + `out/` | ロジック・結合（IPC / 画面 / PTY） | 毎変更 |
| `make e2e-packaged`（スモーク4本） | `electron-builder --dir` が生成した本物の .app | 上記 + パッケージング（asar / `isPackaged: true` / 本番 preload / asarUnpack した node-pty） | `make install-app` の関門として自動実行 |

**天井: 本物の launchd（Finder / Dock）起動・Gatekeeper・署名は、どちらのレーンでも検証できない。** Playwright は自分の子プロセスとしてアプリを起動するため、launchd の最小環境そのものは再現できない。この層は「テストで防ぐ」のではなく「起きたら一発で特定できる」に切り替える: 起動時の重要処理は診断ログを常設する（例: PATH 解決の `~/.ai-terminal/shell-path.log`。Issue #40 の真因特定はこれが決め手だった）。

**隔離設計そのものが作る盲点にも注意。** 偽 CLI を PATH の先頭に置く隔離のせいで、ログインシェルからの PATH 補完（`src/main/shell-path.ts`）が完全に壊れていても全シナリオ green だった（Issue #40 はこれですり抜けた）。S39 は偽 CLI を `.zshrc` 経由でのみ露出し、この経路を端から端まで踏む。launchd の最小 PATH は再現できないが、「最小 PATH + ログインシェル経由でのみ CLI に到達できる」という条件は再現できる。

**隔離ハーネスが自前の値を持つと、アプリの既定値を変えても届かない。** ハーネスの `DEFAULT_CONFIG` は
`@shared/defaults` を import せず theme の色を手で持っており、既定色を変えても E2E と撮影には反映されなかった
（撮り直した画像すべてに、ターミナル背景と CSS の面のズレによる 4px の帯が写る状態だった）。
**ハーネスに書いてよいのは「速く・決定的にするための E2E 固有の値」だけで、アプリの既定値は import する。**

## CI で回していない理由

E2E は CI に組み込んでいない（**単体テストは `npm run unit` として CI で走る**）。Linux ランナーでは Electron の GUI 起動に xvfb が要り、macOS ランナーは実行コストが高い（`playwright.config.ts` のコメントにも明記）。現状は**ローカル実行のみ**（`make e2e`）。

**`make e2e` がウィンドウを表示しないことは、CI 対応を意味しない。** あれは Electron のウィンドウを画面に出さないだけで、OS のウィンドウサーバ（macOS の GUI セッション）は必要なまま。ヘッドレスな Linux ランナーで回すには依然として xvfb が要る。両者を混同しないこと（詳細は [../operations/run-e2e.md](../operations/run-e2e.md)）。

---

## spec を書くときに踏んだ落とし穴は別ファイル

このファイルは**担保できない範囲と、人手の手順書**を扱う。
spec の書き方そのもので繰り返し踏んだ罠は [spec-writing-traps.md](spec-writing-traps.md) へ分けた
（500行の上限を超えたため。2026-08-05）。
