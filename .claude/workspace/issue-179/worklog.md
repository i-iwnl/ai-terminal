# Worklog

時系列の作業ログ。**設計判断の根拠**と**学んだ教訓**を中心に記録する。
コード差分は git log を参照、現状の構造は `architecture.md` を参照。

---

## 2026-08-04 - ワークスペース作成と周1 の計画

### 実施内容

- `gh issue view 179` と対象7件（#165 / #169 / #164 / #166 / #167 / #170 / #175）の状態を確認。**7件すべて OPEN**
- `origin/main` は `2f82675`（#174 の修正が PR #182 として squash マージ済み）。ローカルの `fix/178-terminal-links-open-in-browser` に残る `e69406d` は**その重複**なので、周1 は `origin/main` から新しくブランチを生やす
- loop.md の計画ゲート「計画書の前提を実コードで測り直す」に従い、2軸を並列調査した
  - 軸A: `e2e/fixtures/contrast.ts` / S40 / S41 / `styles.css` のトークンとセレクタ
  - 軸B: `scripts/verify-screenshots.mjs` / `e2e/screenshots.spec.ts` / `e2e/fixtures/harness.ts` / ペインヘッダ

### 設計判断

- **#165 の対処方針が実コードとずれていた**: `ContrastTarget` には `against?: string` と `againstColor?: string` が**既にある**。
  ハーネスの API 追加は不要で、欠けているのは S40 の計測対象だけ -> `known-issues.md` 1番に記録
- **プロバイダ色は `againstColor: '--surface-tab-active'` で測る**: アクティブなタブは同時に1つしか作れないので、
  3本を1回のセットアップで測るにはトークン値と比べるのが素直。`@media` はトークンを差し替えるので高コントラスト側も同じ書き方で追従する
- **S56 の非決定性は `PROMPT_EOL_MARK=''` で潰す**: SKIP 理由に「zsh の部分行マーカー（反転表示の `%`）」と実測記録がある。
  待ち合わせを増やしても「出るときは出る」ので消えない。**そもそも出さない設定にする**

### 実コードで確認できた事実（周1 の根拠）

| 事実 | 出典 |
|---|---|
| プロバイダ色は `border-top: 2px solid var(--tab-provider-*)` の3セレクタだけで使われる | `styles.css` `.tab-bar__tab--shell/--claude/--gemini` |
| S40 はその3本を `against` 無しで登録している -> `measureContrast` の border 分岐で**親 `.tab-bar`（`--surface-1`）**と比べられる | `contrast.ts` の `item.property.startsWith('border') && el.parentElement ? el.parentElement : el` |
| `@media (prefers-contrast: more)` は8トークンを上書きするが、**`--tab-provider-*` は1本も入っていない**。`--surface-tab-active` は `#2e2e2e` -> `#525252` に上がる | `styles.css` の `@media` ブロック |
| `.tab-bar__tab.is-active`（`--text-bright`）と `.tab-bar__tab.is-exited`（`--status-exited`）は**詳細度が同じ (0,2,0)** で `.is-exited` が後勝ち | `styles.css` の宣言順 |
| `KNOWN_NONDETERMINISTIC` の中身は `S56-split-pane.png` の**1件だけ**。SKIP されるのは check3 のみで check1 / check2 は走る | `scripts/verify-screenshots.mjs` |
| S56 の撮影は**アクティブ側のペインのプロンプトしか待っていない**（2枚目は `toHaveCount(2)` と `.pane-header` 非空だけ） | `e2e/screenshots.spec.ts` の `screenshots S56 分割表示` |
| ハーネスの `.zshrc` は `PROMPT='%1~ %# '` / `RPROMPT=''` を書くが `PROMPT_EOL_MARK` には触れていない | `e2e/fixtures/harness.ts` `launchApp` |
| `make e2e-screenshots` は `docs/images/` に、`make e2e` は `e2e/.screenshots-out` に書く。check の `--dir` 既定は後者 | `Makefile` |

### 教訓（該当する場合）

- **「関門を作る口が無い」と書かれていても、原典を開くと既にあることがある。** #165 は口の追加を求めていたが、
  `against` / `againstColor` は実装済みで、S40 がそれを**使っていなかった**だけだった。
  loop.md が言う「行番号ではなく関数名・セレクタで特定する」を守ったことで、周1 のスコープが実際に縮んだ

### 次に再開するとき最初に読むべきこと

- **周1 は未着手。** `origin/main` から `test/179-contrast-and-screenshot-gates` を切るところから始める
- 周1 でやること（値・振る舞いを1つも変えない）:
  1. S40 に `--surface-tab-active` を背景としたプロバイダ色3本を足し、**赤くなることを実測して worklog に記録する**
  2. S41 に高コントラスト側の同じ3本を足す（`emulateMedia({ contrast: 'more' })` は S41 にしかない）
  3. `harness.ts` の `.zshrc` に `PROMPT_EOL_MARK=''` を足す
  4. `verify-screenshots.mjs` の `KNOWN_NONDETERMINISTIC` から `S56-split-pane.png` を外し、`make e2e` を**3回**回して check3 が安定して通ることを確認する
  5. 効かなければフォールバック（ヘッダを含む決定的な別カットを1枚足す）に切り替える
- **検証順序の注意**: `make e2e-screenshots-check` の比較元は `e2e/.screenshots-out` なので、**`make e2e` を先に回す**（`known-issues.md` 2番）
- 周2 以降の順序制約は `overview.md` の「順序の制約」を見る。動かさない

---

## 2026-08-04 - 周1: 関門を先に作る（#165 前半 / #169）

### 実施内容

- ブランチ `test/179-contrast-and-screenshot-gates` を `origin/main`（`2f82675`）から作成
- **#165 前半**: S40 にプロバイダ色3本 × `--surface-tab-active` の計測を追加。S41 に高コントラスト側を追加
- **#169**: S56 の撮影前の待ち合わせを強くし、`verify-screenshots.mjs` の `KNOWN_NONDETERMINISTIC` を空にした
- **製品コード（`src/`）は1行も触っていない。** 触ったのは `e2e/` 3ファイルと `scripts/` 1ファイルのみ

### 関門が実際に赤くなることの確認（周1 の本体）

**#165 の関門。** 一時的に `toBeGreaterThanOrEqual(3.0)` に差し替えて実行し、赤くなることを確認した:

```
Error: シェルタブの色相の枠（選択中タブ上） が高コントラストで 3:1 を満たしていない
Expected: >= 3
Received: 2.4048299191697136
```

実測値は Issue #165 の表と**小数第2位まで一致**した:

| トークン | 対 `--surface-1` | 対 `--surface-tab-active`（#2e2e2e） | 高コントラスト（#525252） |
|---|---|---|---|
| `--tab-provider-shell` | 5.13 | **4.18** | **2.40** |
| `--tab-provider-claude` | 4.27 | **3.48** | **2.00** |
| `--tab-provider-gemini` | 4.82 | **3.93** | **2.26** |

**「コントラストを上げる」が、この3本のコントラストを下げている**（4.18 -> 2.40）。
`--surface-tab-active` だけ明るくして前景を数え直していないため。

**#169 の関門。** SKIP を外した結果、`make e2e-screenshots-check` の出力から `[SKIP]` が
消え、`check3: S56-split-pane.png の画素が一致する（最大差 0）` が出るようになった（PASS=39 / FAIL=0）。

### 設計判断

- **プロバイダ色3本は S41 の既存 `targets` に入れず、別バッチ + characterization にした。**
  既存ループは全項目に `high > normal` を要求するが、この3本は現時点で**下がる**。
  同じループに入れると周1 で赤くなり `make e2e` を緑に保てない（CLAUDE.md「赤いまま push しない」）。
  代わりに **`PROVIDER_HIGH_NOW` で現在値を固定し、3:1 を満たした瞬間に赤くなる番人**を付けた。
  S40 の `staleFail` と同じ作法で、**周2 で直したときに閾値 assert への切り替えを強制する**
- **S56 の待ち合わせは先頭行の「完全一致」にした。** 部分一致で書いた最初の版は、
  `clear` がエコーされた `demo-project % clear` の状態でも素通りした

### 教訓（該当する場合）

- **⚠ 除外リストに書かれた「非決定の原因」が誤っていた。** `KNOWN_NONDETERMINISTIC` は
  「zsh が部分行マーカーを出す。**実際の端末内容**」と記録しており、これは
  「待っても無駄」と読める。立案時はそれを信じて `.zshrc` に `PROMPT_EOL_MARK=''` を
  足す計画にしたが、**8回撮って比べたら効かなかった**（2種類のまま）。
  正体は素朴な競合で、**待てば決まった**（待ち合わせを足すと 8枚が1種類）。
  しかもその画像は**コミット済みの1枚と1画素も違わなかった** = 画像の差し替えすら不要だった。
  **規約は「原因を実測してから書け」までしか要求しておらず、「なぜ待っても無駄なのか」は
  検証されないまま除外が永続化していた**（`known-issues.md` 3番に記録）
- **自分の計画も同じ壊れ方をする。** 上の `PROMPT_EOL_MARK` 案は `architecture.md` の
  設計判断履歴に「確実」と書いて記録済みだった。**実測が反証したので、その行を
  取り消し線付きで残して差し替えた。** loop.md の「ずれていたら、着手する前に記録を訂正する」は
  Issue 本文だけでなく**自分が数十分前に書いた設計判断にも適用される**
- **「赤くなるか確かめた」の反証テスト自体が空振りすることがある。** S56 の待ち合わせが
  効いているかを確かめるため「`clear` を打つ版」に戻して回したが**緑だった**。
  強い assert が `clear` の完了を待ち切ってしまうためで、この実験は何も分離していない。
  分離できたのは**正規化を外して8回撮り、画像が何種類になるかを数えたとき**だった。
  **assert の成否ではなく、成果物（画像）のばらつきを数えるほうが決定的**

### 検証

| 関門 | 結果 |
|---|---|
| `make check` | 38 ファイル / 555 テスト green |
| `make e2e` | **101 passed / 3 flaky**（S47・S60・S90。いずれも `launchApp` 内で、単独再実行は3件とも green。撮影を16回回した直後でマシンが重く、loop.md の「まず負荷を疑う」に当たる。触ったファイルとは無関係） |
| `make e2e-lint` | PASS=743 / **FAIL=0** |
| `make e2e-screenshots-check` | PASS=39 / **FAIL=0**（13枚 × 3 check。`[SKIP]` は0件） |
| 実機確認 | **この周は該当なし。`src/` を1行も触っておらず、画面に出る変化が無い**（`git diff --name-only` は `e2e/` 3件と `scripts/` 1件のみ）。省いたことをここに明記する |

`docs/images/` は**1枚も変更していない**。撮り直した13枚のうち11枚は画素差ゼロのバイト差、
S18 は最大チャンネル差1（許容ノイズ `MAX_CHANNEL_DELTA=2` の範囲内・超過画素0）だったので、
CLAUDE.md の規定どおりコミットに含めず戻した。

### 次に再開するとき最初に読むべきこと

- **周1 は実装・検証とも完了。commit / push / PR はユーザーの指示待ち**（ルート CLAUDE.md）
- ブランチは `test/179-contrast-and-screenshot-gates`（`origin/main` から。スタックしない）
- **周2 に入る前に、この周の PR を main にマージすること。** 周2 は #165 後半（`@media` に
  プロバイダ色3本を追随させる）と #164（`.is-active.is-exited` の結合状態規則）で、
  **周1 の関門が main に入っていないと「直った」ことを確認できない**
- 周2 で必ず触る3箇所（周1 が仕込んだ番人）:
  1. `S41` の `PROVIDER_HIGH_NOW` — 固定をやめ `toBeGreaterThanOrEqual(3.0)` と `high > normal` へ
  2. `S40` の `'終了したタブの文字（選択中・対 --surface-tab-active）'` 4.47 と
     `'終了バッジの文字（選択中）'` 4.47 — #164 を直すと `--text-bright` に戻るので値が動く。
     `wcag: 'fail'` の札も `staleFail` が更新を強制する
  3. `S41` 末尾の `exitedNormal[...] toBeCloseTo(4.47, 1)` 2行 — 同上
- **#164 は値を1つも変えずに直す**（`.tab-bar__tab.is-active.is-exited` を詳細度 (0,3,0) で足すだけ）。
  現状は `.is-active` と `.is-exited` が同じ (0,2,0) で、後に宣言されている `.is-exited` が後勝ちしている

---

## 2026-08-04 - 周2: design-review で案が覆り、関門づくり + #164 に組み替えた

### 実施内容

- 周2 は `styles.css` を触るので `/design-review`（5ペルソナ並列）を計画確定前に通した。
  **#179 本文は「design-review を差し込むのは周3」と書いていたが、起動条件の判定は
  design-review 側の SKILL.md が唯一の正**（loop.md がそう定めている）
- **提案 A（#165 後半）が5人中4人から独立に否定され、却下した**
- 周2 を2本の PR に組み替えた: PR #184（関門の訂正・拡充）-> PR #185（#164）

### 提案 A が却下された理由（実測）

案 = プロバイダ色3本の色相・彩度を保ち、明度だけ上げて対 `#525252` で 3:1 を取る。

| 測る対象 | 現状 | 案 | 向き |
|---|---|---|---|
| 面（`#525252`）との比 | 2.40 / 2.00 / 2.26 | 3.05 / 3.08 / 3.06 | 改善（狙いどおり） |
| **フォーカスリング（白）との比** | 3.25 / 3.90 / 3.46 | **2.54 / 2.56 / 2.55** | **3:1 割れ** |
| **帯どうしの相互比** | 1.20 / 1.06 / 1.13 | **1.01 / 1.00 / 1.01** | **等輝度＝識別不能** |

**両立不能が証明された**: 対 `#525252` で 3:1 には `L >= 0.3531`、対 `#ffffff` で 3:1 には `L <= 0.3000`。
区間が交わらないので **24bit の全色に解が無い**。`border-top: 2px` の真下に
`outline-offset: -2px` の白いフォーカスリングが**隙間 0px で接する**ため。

### 実機確認（agent-browser + CDP）

**E2E は `--disable-gpu` で DOM レンダラを使うが、実機は WebGL（canvas）。** ターミナルの文字は
DOM に無いので `.xterm-rows` が読めない。`agent-browser type` も xterm には届かず、
**1文字ずつ `press` して初めて入った**（`press Enter` だけは効いていた）。

| 確認したこと | 結果 |
|---|---|
| 選択中かつ終了のタブ（class） | `tab-bar__tab tab-bar__tab--shell is-active is-exited` |
| そのタブの文字色 | `rgb(255,255,255)` = `--text-bright`（対 `#2e2e2e` で 13.58） |
| バッジ「終了」の文字色 | `rgb(255,255,255)` — **宣言を落として継承させた結果、タイトルと一致** |
| 閉じるボタン `x` の色 | `rgb(255,255,255)` — レビューが指摘した4つ目の `color: inherit` の波及先 |
| 四角（`--state-slot--exited`） | `rgb(212,123,123)` = `#d47b7b` **据え置き**。終了を運ぶ色として残る |
| **ホバー中**（E2E では作れない） | 文字・バッジ・`x` とも白のまま。閉じるボタンは `opacity: 1 / display: block` |
| **非選択に戻したとき**（2枚目のタブを開く） | 文字・バッジとも `rgb(212,123,123)` に戻る。**選択状態で切り替わることを実機で確認** |

### 設計判断

- **#164 は `.is-active.is-exited { color: var(--text-bright) }` を足す形にしなかった。**
  それだと `--text-bright` が2箇所に散り、`.is-active` の色を将来変えたときに結合状態の規則だけが
  古い色を握って残る（= #164 が直そうとしている壊れ方の再生産）。
  代わりに `.tab-bar__tab.is-exited:not(.is-active)` へ倒し、`--text-bright` の出現は1箇所のまま
- **バッジはセレクタを足さず、`color` の宣言を落とした。** タブの色を継承するので、
  タイトルとバッジが**永久にずれない**。規則が1本増えるどころか1本減る
- **S41 の `exitedTargets` ループを「前景が動くもの / 天井に張り付いたもの」で分けた。**
  白は輝度の天井なので、面が明るくなれば比は必ず下がる（13.58 -> 7.81）。
  **一律に緩めると、まだ追随が要る項目（四角）の番人まで消える**ので分けた

### 教訓（該当する場合）

- **⚠ 周1 が S41 に残した是正指示が誤っていた。** 「`high > normal` の assert に切り替えよ」と
  書いたが、`providerTargets` は**面自体が動く**ので normal と high は別の面の上の値。
  大小比較に意味がない。**`high > normal` が不変条件として意味を持つのは、面が動かない対象だけ。**
  4人が独立に指摘した。**番人のメッセージも、書いた時点の思い込みごと固定されて次の人を誤らせる**
- **周1 が数えた「番人3箇所」は4箇所だった。** `S41` の `exitedHigh > exitedNormal` ループが漏れており、
  #164 を入れた瞬間に赤くなった（実際に赤くなるところまで観測した）
- **`color: inherit` の波及先を2箇所と数えたが実際は4箇所**（`.tab-bar__close` と `.tab-bar__title-input`）。
  `design-rules.md` は Issue #134 の教訓としてこの数え漏れ自体を記録しており、**同じ表を再度踏んだ**
- **ΔE の数値を、測っている座標系を書かずに引用した。** 却下事例の 5.8 は**1型色覚変換後**の値で、
  案が並べた 5.2 は**生の sRGB**。3人が指摘した。**ΔE は「生 / 変換後」を必ず列に書く**
- **「1本の PR にまとめる」根拠が事実として成り立っていなかった。** 「同じ期待値表を触る」と書いたが、
  #165 後半と #164 が触る行は S40 / S41 で**1行も重ならない**（100行以上離れた別ブロック）

### 検証

| 関門 | 結果 |
|---|---|
| `make check` | 555 テスト green |
| `make e2e` | 98 passed / 6〜8 flaky（毎回顔ぶれが変わり、いずれも `launchApp` 内で retry 済み。**長時間 Electron を回し続けた負荷**。loop.md「まず負荷を疑う」に当たる） |
| `make e2e-lint` | FAIL=0 |
| `make e2e-screenshots-check` | FAIL=0。**`docs/images/` は1枚も変わらない**（`screenshots.spec.ts` に `exit` 0件 / `emulateMedia` 0件 = 撮影レーンは終了タブにも高コントラストにも構造的に到達できない） |
| `make css-substitution-check` | **意図どおり落ちた**（CLAUDE.md「値を意図的に変えるときだけ落ちてよい」）。出力は `.is-exited` -> `.is-exited:not(.is-active)` と `color: #d47b7b` が 2箇所 -> 1箇所 の3行だけで、**意図しない置き換えが無いことの証明になっている** |
| 実機確認 | 上の表のとおり実施（ホバー中・非選択に戻したときを含む） |

### 次に再開するとき最初に読むべきこと

- **周2 は完了（PR #184 / #185）。#164 は close、#165 は後半が残るので open のまま**
- **次は #165 後半。周を1つ増やして扱う**（`known-issues.md` 4番に設計の制約を全部書いた）。
  **色を明るくするだけでは解けない**ので、輝度以外の軸を使う案から始める:
  - 帯の水平位置をプロバイダごとに変える（`border-top` を `linear-gradient` の `background-image` に）
  - 実線 / 破線で分ける（`repeating-linear-gradient`）
  - フォーカスリングの `outline-offset` を `-4px` にして帯とリングの間に塗りを挟む（1セレクタ2行）
  いずれも**追加ピクセル0・新トークン0**。`/design-review` を計画確定前にもう一度通すこと
- **その周が触る関門**: `S41` の `PROVIDER_HIGH_NOW` と `ADJACENT_HIGH_NOW`。
  後者はフォーカスリング側に 3:1 の閾値 assert が入っているので、**色を動かすと必ず赤くなる**
- 周3（#166）以降の順序制約は `overview.md` を見る。**#164 -> #166 の順序は守られた**

---

<!-- 以降、作業のたびにセクションを追記 -->
