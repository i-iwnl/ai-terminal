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

## spec を書くときに繰り返し踏んだ落とし穴

**すべて実際に落ちてから直したもの。** 書く前に読むこと。

### 起動直後にキーを押さない（`useEffect` のリスナは間に合わない）

グローバルショートカットの keydown リスナは `App.tsx` の `useEffect` で張られる。
**マウント前に押したキーは失われる。**

```ts
// 悪い: いきなり押す（アプリの初期化を待っていない）
await window.keyboard.press('Meta+t');

// 良い: 最初のシェルタブが出るまで待ってから押す
await expect(window.locator('.tab-bar__tab')).toHaveCount(1, { timeout: 15_000 });
await window.keyboard.press('Meta+t');
```

**S55（#96）と S67 / S68（#107）がこれで落ちた。** `S06` などが最初に `toHaveCount(1)` を
待っているのは同じ理由。

### `viewportSize()` は Electron では `null` を返す

Playwright がビューポートを設定していないため。**実寸は Renderer に聞く。**

```ts
const width = await window.evaluate(() => window.innerWidth);
```

`e2e/screenshots.spec.ts` が同じ理由で `window.innerWidth` を使っている。

### 撮影レーンは `make e2e` に含まれている（Issue #120 D-1 で取り込んだ）

**この節はかつて「セレクタを変えたら `e2e/` 全体を grep する」だった。効かなかった。**

`e2e/screenshots.spec.ts` は `e2e/` 直下にあり `e2e/specs/*` の glob から漏れるため、
PR #86 でセレクタが壊れたとき `make e2e` は全 green のまま main に入った（Issue #90）。
対策としてここに「grep せよ」と書いたが、**人が思い出すことに賭ける対策は機能しなかった。**

いまは `playwright.config.ts` の**第2 project** として `make e2e` に入っている。

- コストは実測で **+12秒 / 163秒 = +7%**
- **`docs/images/` は書き換えない。** `make e2e` は `AI_TERMINAL_E2E_IMAGES_DIR` で
  出力先を `e2e/.screenshots-out/`（gitignore 済み）へ振る。
  **同じコードで2回撮っても13枚中13枚がバイト差になる**ので、
  `make e2e` のたびに約940KB のバイナリが dirty になるのを避けている
- README 用の画像を実際に更新するのは `make e2e-screenshots` のまま

**`make e2e-lint` の check10** が「`e2e/` 配下の spec が、どの config の
`testDir` / `testMatch` にも入っていない」を検査する。また同じ形の事故
（ファイルの所在がレーンから外れる）が起きたら、実行しなくても分かる。

### 「参照しているクラスが実装に存在するか」の静的検査は採らなかった

Issue #120 D-1 が提案していたが、**防ぎたい当の事例を捕まえられない。**

PR #86 で壊れたのは**入れ子構造**で、クラス名ではない。

```
.tab-bar__tabs > .tab-bar__tab                       （変更前）
.tab-bar__tabs > .tab-bar__tablist > .tab-bar__tab   （変更後 = ラッパーを挿入）
```

`tab-bar__tabs` も `tab-bar__tab` も変更後の実装に残っているので、静的検査は PASS を返す。

加えて誤検知が多い。実測（`screenshots.spec.ts` の25トークン）で、
最も緩い照合（src 内の任意トークン OR css）でも **12%** が「存在しない」と誤判定される。
主因は2つ:

- **動的な className が18件**（`` `task-item--${state}` `` / `` `notice-banner--${n.severity}` `` など）。
  `className=` の素朴な grep では取れない
- **`@xterm/xterm` が所有するクラス**（`.xterm-screen` / `.composition-view` /
  `.xterm-helper-textarea` など）。**このリポジトリの src にも css にも無い**ので、
  どんな照合先を選んでも消えない = 恒久的な allowlist が要る

### 注釈のセレクタが外れたら落ちる（黙って飛ばさない）

`screenshots.spec.ts` の `annotateAndShoot()` は、以前 `if (!target) continue;` で
**マッチしなかった注釈を黙って飛ばしていた**。注釈が抜けた画像を吐いて green になり、
**この `selector` フィールドからしか参照されないセレクタが12件**あったので、
撮影レーンを回すこと自体が担保になっていなかった（PR #86 が落ちたのは、
たまたま壊れたのが `locator()` 側だったから）。

いまは throw する。エラーは「セレクタが1件もマッチしない」と
「N件マッチしたが textContent が一致しない」を**分けて報告する**（直す場所が違う）。

### 1 spec = 1 `test()`

`make e2e-lint` の check7 が機械的に検査する。**`test()` を2つ書いたらファイルを分ける**
（`scenarios.yml` も2エントリに分ける）。

### 順序に依存するセレクタを書かない

`.foo').first()` は並び順が変われば別の要素を指す。**内容で引くか、状態クラスで絞る。**

- `S39` はタスク一覧の**先頭行**で `demo-project` を引いていて、並び順を変えた PR 8 で落ちた
- `S40` も同じ理由で「一覧の先頭 = busy」を前提にしていた

### 「押せるはずの領域が本当に押せるか」は S44 では分からない

`S44` は**小さいボタンが 24x24 以上あるか**を見る検査で、
**大きい要素の内側に死角があることは検出しない。**

PR 19（#108）でタブの中央がコンテナの `<div>` に当たり、
**クリックしても何も起きない**状態になっていたが、S44 は green のままだった。

**押せることを主張するなら `document.elementFromPoint(中央)` が
目的のインタラクティブ要素に解決することを見る**（`S69` がその形）。
座標は決め打ちせず `boundingBox()` から計算する。

### 合成 DOM を注入する spec は、CSS の位置指定を変えると壊れる

`S44` は `.notice-banner` を `document.body` 直下に注入して当たり判定を測っている。
PR 11（#96）で `position: absolute` を親の `.notice-list` へ移したとき、
**注入した要素が通常フローに落ちてビューポート外へ出た。**

**`position` を動かすときは、合成 DOM を注入している spec を探すこと。**
