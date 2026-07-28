# E2E を実行する

`make e2e` / `make e2e-headless` / `make e2e-lint` / `make e2e-report` の4ターゲットをどの場面で使うかをまとめる。コマンドの定義（何を実行しているか）はルート [CLAUDE.md](../../../../CLAUDE.md) と `Makefile` が唯一の正なので、ここでは再掲しない。

## どのターゲットを使うか

| 場面 | ターゲット |
|---|---|
| spec を追加・変更した後、実際に Electron を起動して green か確認する | `make e2e` |
| 作業を続けながら回す（ウィンドウに画面を奪われたくない） | `make e2e-headless` |
| `scenarios.yml` と `e2e/specs/` の対応だけを機械検査したい（Electron を起動せず速い。実装が無くても回せる） | `make e2e-lint` |
| 直近の実行結果を後から見返す | `make e2e-report` |

`make e2e` はビルド済みの `out/` を使うため `build` に依存する（コードを変更したら再ビルドされてから実行される）。

## ヘッドレス実行について

**Electron に真のヘッドレスモードは無い。** `BrowserWindow` はネイティブウィンドウを要求するため、Chromium の `--headless` は効かない。`make e2e-headless` がやっているのは「起動直後に `BrowserWindow.hide()` を呼ぶ」ことで、ウィンドウは存在するが画面に現れない。アプリ本体のコードは変更していない（ハーネス側から `app.evaluate()` で隠している）。

**隠しても検証できる範囲は狭まらない。** macOS / Electron 43 での実測:

| | 表示あり | 非表示 |
|---|---|---|
| `requestAnimationFrame` の1秒あたりフレーム数 | 61 | 61 |
| WebGL レンダラの非背景ピクセル数（入力前 -> 後） | 2085 -> 4694 | 2085 -> 4694 |

描画が止まらず、`capturePage()` のピクセルも表示時と一致した。全32シナリオを `make e2e-headless` で通しても結果は変わらない（描画・マウス選択・IME 経路を含む）。

**ただし OS 側の都合は隠せない。** ウィンドウを隠すのは Electron の可視性であって、OS のウィンドウサーバは動いている（macOS では GUI セッションが必要）。**CI の Linux ランナーでヘッドレスに回したい場合は別問題で、そちらは `xvfb` が要る**（[../reference/limitations.md](../reference/limitations.md) の「CI で回していない理由」を参照）。

## 落ちたときの調べ方

1. **HTML レポート**: `make e2e-report` で開く。失敗したテストのステップごとのタイムラインと、失敗時に撮られたスクリーンショットが確認できる
2. **trace**: `playwright.config.ts` で `trace: 'retain-on-failure'` としているため、失敗したテストのみ `test-results/<テスト名>/trace.zip` が残る。`npx playwright show-trace <path>` で開くと、アクション単位の DOM 差分・コンソールログ・ネットワークが見られる
3. **`test-results/<テスト名>/error-context.md`**: 失敗時に Playwright が自動生成するアクセシビリティスナップショット。DOM の状態をテキストで確認できる（アプリを起動し直さなくても状況が分かる）
4. **`test-results/<テスト名>/*.png`**: `screenshot: 'only-on-failure'` の設定により、失敗時のスクリーンショットが残る

`e2e/report` と `test-results/` はどちらも実行のたびに上書きされる。過去の失敗を保存したい場合は先に退避する。

## DoD（完了条件）

- 対象シナリオが `make e2e` で green
- 全部 green になるまで完了扱いにしない
