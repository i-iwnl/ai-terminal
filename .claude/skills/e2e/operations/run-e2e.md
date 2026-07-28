# E2E を実行する

`make e2e` / `make e2e-visible` / `make e2e-lint` / `make e2e-report` の4ターゲットをどの場面で使うかをまとめる。コマンドの定義（何を実行しているか）はルート [CLAUDE.md](../../../../CLAUDE.md) と `Makefile` が唯一の正なので、ここでは再掲しない。

## どのターゲットを使うか

| 場面 | ターゲット |
|---|---|
| spec を追加・変更した後、実際に Electron を起動して green か確認する | `make e2e` |
| テストが何をしているのか目で追いたい | `make e2e-visible` |
| `scenarios.yml` と `e2e/specs/` の対応だけを機械検査したい（Electron を起動せず速い。実装が無くても回せる） | `make e2e-lint` |
| 直近の実行結果を後から見返す | `make e2e-report` |

`make e2e` はビルド済みの `out/` を使うため `build` に依存する（コードを変更したら再ビルドされてから実行される）。

## ウィンドウ非表示が既定であること

**`make e2e` はウィンドウを画面に出さない。** 表示したまま走らせると、テスト中のキー入力とマウス操作を Electron のウィンドウが奪い、実行中は他の作業ができなくなるため。

**Electron に真のヘッドレスモードは無い。** `BrowserWindow` はネイティブウィンドウを要求するため、Chromium の `--headless` は効かない。ハーネスは代わりに、`app.evaluate()` で Main プロセス側の `BrowserWindow.prototype` の `show` / `showInactive` / `focus` / `moveTop` を無効化する。`webContents` は生きているので、DOM 操作・CDP 入力・`capturePage()` は従来どおり動く。アプリ本体のコードは変更していない。

macOS では加えて `app.dock.hide()` を呼ぶ。**ウィンドウを出さなくても、アプリの起動そのものがアプリケーションをアクティブにしてキーボードフォーカスを奪う**ため。Dock アイコンを消すとアクセサリ扱いになり、アクティブ化も Cmd+Tab への出現もしなくなる。

### ⛔ 「表示してから隠す」ではいけない

最初の実装は `firstWindow()` の後に `win.hide()` を呼んでいた。これは3つの意味で失敗だった:

1. **一瞬ウィンドウが現れてフォーカスを奪う。** それがテストの本数だけ繰り返される（＝解決したかった問題がそのまま残る）
2. **遅い。** 表示 -> 非表示の遷移コストで、1テストあたり約 4.6 秒余計にかかった。全32シナリオで **約3分 -> 27秒** の差になる
3. **`page.screenshot()` が 30 秒でタイムアウトする。** 一度表示したウィンドウを隠すと Chromium が occluded 扱いにして合成を止めるため、CDP の `Page.captureScreenshot` がフレームを待ち続ける

`show()` を最初から無効化すれば、この3つとも起きない。実測で `isVisible()` / `isFocused()` がいずれも常に false であること、README 用の撮影12枚が表示時と同じ画像になることを確認済み。

**「隠す」の実現方法によって、できることが変わる。** 同じ「ウィンドウが見えない」状態でも、表示済みを隠したのか最初から出していないのかで Chromium の扱いが違う。方式を変えるときは撮影まで通して確認すること。

### 隠しても検証できる範囲は狭まらない

macOS / Electron 43 での実測:

| | 表示あり | 非表示 |
|---|---|---|
| `requestAnimationFrame` の1秒あたりフレーム数 | 61 | 61 |
| WebGL レンダラの非背景ピクセル数（入力前 -> 後） | 2085 -> 4694 | 2085 -> 4694 |

描画が止まらず、`capturePage()` のピクセルも表示時と一致した。全32シナリオが非表示のまま green（描画・マウス選択・IME 経路を含む）。

**`backgroundThrottling` は関係ない。** 遅さの原因を Chromium のバックグラウンド throttling と疑い、`webPreferences.backgroundThrottling: false` を試したが**測定値は変わらなかった**。原因は上記の表示遷移。アプリ側の設定は変更していない。

### 撮影も隠したままでよい

`make e2e-screenshots`（`page.screenshot()`）も非表示のまま動く。全12枚が表示時と同じ内容になることを実測で確認した。

前は「撮影には表示が要る」として `screenshots.spec.ts` で表示を強制していたが、**これは誤りだった**。タイムアウトしていたのは上の「表示してから隠す」方式のときだけで、原因を取り違えたまま例外を作っていた。

## OS 側の都合は隠せない

ウィンドウを隠すのは Electron の可視性であって、OS のウィンドウサーバは動いている（macOS では GUI セッションが必要）。**CI の Linux ランナーでヘッドレスに回したい場合は別問題で、そちらは `xvfb` が要る**（[../reference/limitations.md](../reference/limitations.md) の「CI で回していない理由」を参照）。

## 落ちたときの調べ方

1. **HTML レポート**: `make e2e-report` で開く。失敗したテストのステップごとのタイムラインと、失敗時に撮られたスクリーンショットが確認できる
2. **trace**: `playwright.config.ts` で `trace: 'retain-on-failure'` としているため、失敗したテストのみ `test-results/<テスト名>/trace.zip` が残る。`npx playwright show-trace <path>` で開くと、アクション単位の DOM 差分・コンソールログ・ネットワークが見られる
3. **`test-results/<テスト名>/error-context.md`**: 失敗時に Playwright が自動生成するアクセシビリティスナップショット。DOM の状態をテキストで確認できる（アプリを起動し直さなくても状況が分かる）
4. **`test-results/<テスト名>/*.png`**: `screenshot: 'only-on-failure'` の設定により、失敗時のスクリーンショットが残る

`e2e/report` と `test-results/` はどちらも実行のたびに上書きされる。過去の失敗を保存したい場合は先に退避する。

## DoD（完了条件）

- 対象シナリオが `make e2e` で green
- 全部 green になるまで完了扱いにしない
