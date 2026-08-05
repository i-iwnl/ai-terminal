# spec を書くときに繰り返し踏んだ落とし穴

**すべて実際に落ちてから直したもの。** `e2e/specs/` に spec を足す前・直す前に読むこと。

担保できない範囲（人手でしか確かめられないもの）と、その手順書は
[limitations.md](limitations.md) が正。このファイルは**書き方の罠だけ**を扱う。

## 起動直後にキーを押さない（`useEffect` のリスナは間に合わない）

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

## `viewportSize()` は Electron では `null` を返す

Playwright がビューポートを設定していないため。**実寸は Renderer に聞く。**

```ts
const width = await window.evaluate(() => window.innerWidth);
```

`e2e/screenshots.spec.ts` が同じ理由で `window.innerWidth` を使っている。

## 撮影レーンは `make e2e` に含まれている（Issue #120 D-1 で取り込んだ）

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

## 「参照しているクラスが実装に存在するか」の静的検査は採らなかった

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

## 注釈のセレクタが外れたら落ちる（黙って飛ばさない）

`screenshots.spec.ts` の `annotateAndShoot()` は、以前 `if (!target) continue;` で
**マッチしなかった注釈を黙って飛ばしていた**。注釈が抜けた画像を吐いて green になり、
**この `selector` フィールドからしか参照されないセレクタが12件**あったので、
撮影レーンを回すこと自体が担保になっていなかった（PR #86 が落ちたのは、
たまたま壊れたのが `locator()` 側だったから）。

いまは throw する。エラーは「セレクタが1件もマッチしない」と
「N件マッチしたが textContent が一致しない」を**分けて報告する**（直す場所が違う）。

## 1 spec = 1 `test()`

`make e2e-lint` の check7 が機械的に検査する。**`test()` を2つ書いたらファイルを分ける**
（`scenarios.yml` も2エントリに分ける）。

## 順序に依存するセレクタを書かない

`.foo').first()` は並び順が変われば別の要素を指す。**内容で引くか、状態クラスで絞る。**

- `S39` はタスク一覧の**先頭行**で `demo-project` を引いていて、並び順を変えた PR 8 で落ちた
- `S40` も同じ理由で「一覧の先頭 = busy」を前提にしていた

## 「押せるはずの領域が本当に押せるか」は S44 では分からない

`S44` は**小さいボタンが 24x24 以上あるか**を見る検査で、
**大きい要素の内側に死角があることは検出しない。**

PR 19（#108）でタブの中央がコンテナの `<div>` に当たり、
**クリックしても何も起きない**状態になっていたが、S44 は green のままだった。

**押せることを主張するなら `document.elementFromPoint(中央)` が
目的のインタラクティブ要素に解決することを見る**（`S69` がその形）。
座標は決め打ちせず `boundingBox()` から計算する。

## 「はみ出さないこと」の検査は、場所・辺・対象の3つで空振りする

**Issue #67 の関門は、書かれてから #121 A-1 で測るまで一度も赤くならなかった。**
`S56-split-pane.spec.ts` は `.terminal-search` がペインからはみ出さないことを
検査していたが、**3つとも間違っていた。**

| 何を間違えたか | 実際に起きたこと |
|---|---|
| **測る場所** | 「1回分割した直後」で測っていた。そのペインは**検索バーの自然幅より広い**ので、`max-width` があってもなくても結果が同じ。Issue #67 の本体は「4分割で各ペイン 200px 級」 |
| **測る辺** | `searchBox.x + width <= paneBox.right` = **右端**を見ていた。`.terminal-search` は `right: var(--sp-2)` でペイン右端に固定されており、**右端は構造上けっして越えない**。伸びるのも、はみ出すのも**左** |
| **測る対象** | コンテナの `boundingBox()` だけを見ていた。`input { min-width: 0 }` を外すと、**コンテナは `max-width` に収まったまま、中のボタンが箱の外へあふれる**（実測: コンテナ右端 1192・閉じるボタン右端 1218.25・ペイン右端 1200） |

実測値（ペイン 234.25px）:

| 壊し方 | 旧・関門 | 新・関門 |
|---|---|---|
| `.terminal-search` の `max-width` を消す | **green** | 赤（左へ 26px） |
| `input` の `min-width: 0` を消す | **green** | 赤（右へ 18px） |

**対策として入れた形:**

- 検査を**いちばん細いペイン**（分割が拒否されるまで刻んだ直後）へ移した
- **コンテナと全子孫の矩形の和**をペインの矩形と比べる（`querySelectorAll('*')`）
- **「測った条件そのもの」も assert にした** —
  `expect(paneWidth).toBeLessThan(252)`。ペインが自然幅より広ければ本体の
  assert は何も守らないので、**その前提が崩れたら赤くなる**ようにしておく

**一般化: 「A が B からはみ出さない」を書くときは、はみ出す向きを先に決める。**
絶対配置の要素は固定した辺の反対側へ伸びる。そして**箱ではなく中身を測る。**

## 合成 DOM を注入する spec は、CSS の位置指定を変えると壊れる

`S44` は `.notice-banner` を `document.body` 直下に注入して当たり判定を測っている。
PR 11（#96）で `position: absolute` を親の `.notice-list` へ移したとき、
**注入した要素が通常フローに落ちてビューポート外へ出た。**

**`position` を動かすときは、合成 DOM を注入している spec を探すこと。**
