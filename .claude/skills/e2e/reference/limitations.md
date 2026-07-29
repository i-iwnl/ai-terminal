# 自動テストで担保できないもの

この E2E 基盤（Playwright + 隔離ハーネス）が届く範囲には限界がある。「自動化できていないから未検証」ではなく、代替手段とセットで扱う。

## 対象外の項目と代替手段

| 対象外 | 理由 | 代替手段 |
|---|---|---|
| macOS の実 IME（ことえり等）との相互作用 | Playwright は Chromium の DevTools Protocol（`Input.imeSetComposition`）で変換中状態を作れるが、これは xterm.js 側の composition 処理を通すだけで、OS の入力メソッドそのものは動かしていない | S22（[../../../../e2e/specs/S22-ime-composition.spec.ts](../../../../e2e/specs/S22-ime-composition.spec.ts)）が xterm.js 側の経路までを担保する。OS レベルの確認は [/terminal](../../terminal/SKILL.md) の [operations/verify-terminal.md](../../terminal/operations/verify-terminal.md) にある手動チェックリストで行う |
| vim / htop の描画品質 | 崩れているかどうかの判定は人間の目に依存し、機械的な合否基準を作れない | E2E では起動できること・アプリがクラッシュしないことのみを検証する。見た目の崩れは手動確認に委ねる |
| macOS 通知 | Playwright から OS 通知の表示を検証する手段が無い | 検証手段なし（既知の限界として扱う） |
| 通知音が実際に鳴ること | `afplay` の起動は投げっぱなしで、音が出たかを観測する手段が無い | 音源パスの解決規則は `test/unit/` の対象。「鳴らす操作でアプリが落ちない」ことまでが E2E の範囲 |
| Slack / Discord の実サービスへの到達 | 実 Webhook を叩くとテストが外部サービスとネットワークに依存し、URL の秘匿も必要になる | S32（[../../../../e2e/specs/S32-webhook-notify.spec.ts](../../../../e2e/specs/S32-webhook-notify.spec.ts)）がローカルに HTTP サーバを立て、リクエストが届くこととペイロードの形（Slack は `text` / Discord は `content`）を検証する。実サービス側の受理は範囲外 |
| tmux セッションの永続化 | アプリ再起動を跨ぐ挙動であり、1回のテストプロセス内で完結する E2E の前提を超える | 範囲外。ハーネスは `useTmux: false` を固定し、tmux 経路自体を経由しないようにしている |
| `ownedByApp` が true になる肯定側のケース | 偽 CLI が返す `agents --json` の固定データは、アプリが実際に起動時に採番する UUID（`crypto.randomUUID()`）を含められない。ハーネスに「アプリが起動したタスクを偽 CLI の出力へ動的に反映する」仕組みが無いため、原理的に再現できない | 否定側（無関係な固定タスクが誤って owned 扱いにならないこと）のみを S15（[../../../../e2e/specs/S15-task-owned.spec.ts](../../../../e2e/specs/S15-task-owned.spec.ts)）で検証している。肯定側を検証するには、`agents.json` を動的に差し替えられるようハーネスを拡張する必要がある |

## かつて盲点だったもの（S23 で塞いだ）

**描画そのもの。** 既定では全シナリオを `--disable-gpu` で起動するため、以前は DOM レンダラ経路しか通っていなかった。DOM レンダラは文字を実 DOM のテキストノードとして描くので、`xterm.css` の読み込みを忘れていても表示されてしまう。実際にその不具合を全22シナリオ green（当時） のまま見逃し、ユーザーが使う `make dev`（WebGL レンダラ）ではターミナルが真っ黒だった。

現在は S23（[../../../../e2e/specs/S23-webgl-rendering.spec.ts](../../../../e2e/specs/S23-webgl-rendering.spec.ts)）が GPU を有効にしてピクセルを数え、実際に描画されていることを検証する。

**教訓として残すこと: テスト容易性のための設定は、そのまま検証の盲点になる。** `--disable-gpu` は「canvas だと DOM から文字が読めない」という正当な理由で入れたもので、判断自体は誤っていない。誤っていたのは、その裏返しとして何が検証されなくなるかを書き残さなかったこと。同種の設定を足すときは、**それによって通らなくなる経路をこのファイルに書くこと。**

## 本番忠実度の階段と、自動化の天井（Issue #40 / #42）

E2E には「本番にどこまで近いか」の段階があり、レーンを分けている。

| レーン | 起動するもの | 検証できる層 | 実行タイミング |
|---|---|---|---|
| `make e2e`（39本） | node_modules の electron + `out/` | ロジック・結合（IPC / 画面 / PTY） | 毎変更 |
| `make e2e-packaged`（スモーク4本） | `electron-builder --dir` が生成した本物の .app | 上記 + パッケージング（asar / `isPackaged: true` / 本番 preload / asarUnpack した node-pty） | `make install-app` の関門として自動実行 |

**天井: 本物の launchd（Finder / Dock）起動・Gatekeeper・署名は、どちらのレーンでも検証できない。** Playwright は自分の子プロセスとしてアプリを起動するため、launchd の最小環境そのものは再現できない。この層は「テストで防ぐ」のではなく「起きたら一発で特定できる」に切り替える: 起動時の重要処理は診断ログを常設する（例: PATH 解決の `~/.ai-terminal/shell-path.log`。Issue #40 の真因特定はこれが決め手だった）。

**隔離設計そのものが作る盲点にも注意。** 偽 CLI を PATH の先頭に置く隔離のせいで、ログインシェルからの PATH 補完（`src/main/shell-path.ts`）が完全に壊れていても全シナリオ green だった（Issue #40 はこれですり抜けた）。S39 は偽 CLI を `.zshrc` 経由でのみ露出し、この経路を端から端まで踏む。launchd の最小 PATH は再現できないが、「最小 PATH + ログインシェル経由でのみ CLI に到達できる」という条件は再現できる。

## CI で回していない理由

E2E は CI に組み込んでいない。Linux ランナーでは Electron の GUI 起動に xvfb が要り、macOS ランナーは実行コストが高い（`playwright.config.ts` のコメントにも明記）。現状は**ローカル実行のみ**（`make e2e`）。

**`make e2e` がウィンドウを表示しないことは、CI 対応を意味しない。** あれは Electron のウィンドウを画面に出さないだけで、OS のウィンドウサーバ（macOS の GUI セッション）は必要なまま。ヘッドレスな Linux ランナーで回すには依然として xvfb が要る。両者を混同しないこと（詳細は [../operations/run-e2e.md](../operations/run-e2e.md)）。
