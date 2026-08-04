# Worklog

時系列の作業ログ。**設計判断の根拠**と**学んだ教訓**を中心に記録する。
コード差分は git log を参照、現状の構造は `architecture.md` を参照。

---

## 2026-08-04 - ワークスペース作成と、着手前の実測（10件）

### 実施内容

- #159 の棚卸しで起票した Issue 群のうち P1 / P2 を束ねて **#160** を作成した（P3 は #161）
- loop.md の「計画書の『現状はこうなっている』を実コードで測り直す」に従い、**10件を main = 4f6d57e の実コードに当て直した**。#144 / #158 は #159 の棚卸しで 61edbe5 に対して検証済みなので、今回は #132〜#142 の8件を3並列のワーカーで測った
- 判定は**全件が有効**（既に解決していたものは0件）。ただし**本文の記述にずれが6件**あり、各 Issue にコメントで訂正した
- 周1〜周10 を確定し、`overview.md` に完了条件を観測できる形で置いた

### 実測で分かったこと（最重要）

**10件すべて、いまその振る舞いを守る関門が無い。** これがこの束ねの構造を決めた。

| Issue | 現状の関門 |
|---|---|
| #132 | 「該当タブが無い」側（S68）だけ。着地の成功経路は0本 |
| #134 | 非テキストだけ S40 が固定。テキスト2箇所は0本 |
| #136 | 0本 |
| #137 | 「`zsh` と出る」は3レーンで固定済みだが「`$SHELL` を反映する」は0本 |
| #138 | 18px という値を守るテストは0本 |
| #142 | 「片方だけ exit / 両方 exit」は0本 |
| #133 | `severityForExit` の unit のみ。dock bounce は観測手段が無い |
| #135 | 0本 |

したがって**周1 を関門づくりに専念させ、値と振る舞いを1つも変えない**。

### 訂正した Issue 本文のずれ（6件）

| Issue | ずれ |
|---|---|
| #132 | 行番号3組（`App.tsx:554-566` → 585-600、`:769`/`:839` → 800/870、`tabPane.ts:88-96` → 133-150）。主張の中身は正しい |
| #136 | 「`grep -rn "プロセスは" e2e/` = 0件」は**実際は2件**（どちらも無関係な散文）。assert が0件という結論は正しい |
| #137 | 「3つの語」は**実際4つ**（`menu.ts` の「新しいシェルタブ」が抜け）。`'zsh'` リテラルは1箇所ではなく **Renderer に4箇所**。**タブバーにも `zsh` が出ている**。README にも2箇所 |
| #138 | 完了条件「`styles.css` に 18px が残っていない」は**達成不能**（`.notice-banner__icon` の 18px は別物）。「`.pane-header` 系の規則に残っていない」へ読み替える |
| #139 | （#161 側）「実測値が一度も取られていない」は**誤り**。S40 の `'非選択セグメントの文字（対トラック）': 6.69` が同じ色の組を既に固定している |
| #133 | 「exit は Main -> Renderer にしか流れていない」は**やや不正確**。`manager.ts` の `onExit` は Main 内で `exitCode` を持っているので、IPC 経路の新設は不要。`notices.ts:35-38` → 36-39 |

### 設計判断

`architecture.md` の「設計判断履歴」が正。要点だけ:

- **P1 と P2 を1本にした。** P1 は2件しかなく、うち #137 はペインヘッダ系で P2 の #138 と隣接するため、分けるより順序を管理しやすい
- **#142 → #140 の順に固定した。** どちらも `TabBar.tsx` の `leaf.exit` 参照4箇所に触り、#142 が `const leaf` を `allExited` に置き換える
- **#137 と #138 を別の周にした。** #137 は画像が必ず変わり、#138 の完了条件は「画像差分0枚」

### 教訓

**1. 「実測値が一度も取られていない」は、別の名前で測られていることがある。**

#139 は「`--text-secondary` を `--surface-2` の上に載せた実測値が一度も取られていない」と書いていたが、S40 の `'非選択セグメントの文字（対トラック）': 6.69` が**まさに同じ色の組**だった。`.sidebar__tabs button:not(.is-active)` は `background: transparent` なので、セレクタを見ただけでは `--surface-2` の上にあると分からない。`contrast.ts` の `effectiveBackground()` が親まで遡る実装を読んで初めて一致する。

**セレクタで grep するだけでは「測られていない」を証明できない。値の組で考える。**

**2. コード内のコメントが計算間違いをしていることがある。**

`styles.css` の `.tab-bar__state-slot--exited` 直上のコメントが「対 `--surface-tab-active` で 4.47。非テキストの 3:1 はもちろん**テキストの 4.5:1 も満たす**」と書いていた。**4.47 < 4.5**。#134 の周で直す。

**3. 「E2E で検証できない」という注記には賞味期限がある。**

S68 / S78 / S63 と `scenarios.yml` の4箇所が「成功経路はハーネスで作れない、解くのは #83」と書いていたが、**#83 は CLOSED で `setAgentEntries()` は実装済み**だった。#159 の棚卸しでも `limitations.md` の `ownedByApp` の行が同じ形で古くなっていた（→ #157）。

**制約を書いたら、その制約を解く Issue の状態と紐づけて定期的に見直す必要がある。**

### 次に再開するとき最初に読むべきこと（**周1 完了により失効。下の周1 エントリを読むこと**）

- **周1（関門づくり）から始める。** `overview.md` の「3. 周の構成」の表が正
- **周1 で作る関門は4本**: (a) #136 = `S55-notice-severity.spec.ts` に終了行の assert、(b) #144 = `src/main/menu.ts` をテキストとして読む静的検査（**Electron を起動しない**。`test/unit/` か `scripts/lint-e2e.mjs`）、(c) #134 = 4.47 / 2.57 を S40・S41 に characterization、(d) #142 = 「片方だけ exit / 両方 exit」の E2E
- **(d) は「両方 exit で出る」側が現状 red になることを先に確認する。** 片方だけ exit の側は現状すでに green なので、そちらだけ書いても何も証明できない
- **「赤くなるか」の確認は `make e2e` で行う。** `npx playwright test` の単体実行は既存の `out/` を見るので、`src/` を壊す検証には使えない（loop.md「空振りする5つの形」）
- **#134 の characterization を S40 に足すときは新しいタブを1枚足す。** S40 は意図的に2枚目を終了させており、「1枚目を exited にすると既存の測定値が変わる」という警告コメントがある
- 各 Issue に投稿した「着手前の実測」コメントが、その Issue の最新の現状認識。**Issue 本文より優先して読む**

---

## 2026-08-04 - 周1: 関門を先に作る（#136 / #144 / #134・#142 の characterization）

### 実施内容

**`src/` を1バイトも変えていない**（`git diff --stat src/` が空）。関門だけを4本足した。

| # | 関門 | 置き場 |
|---|---|---|
| #136 | ペイン内の終了行 `[プロセスは終了しました（コード N）]` | `e2e/specs/S55-notice-severity.spec.ts` に追記 |
| #144 | `accelerator:` を直接書いた項目が `registerAccelerator: false` を伴うこと | `test/unit/menu-accelerators.test.ts`（新規。**Electron を起動しない**） |
| #134 | 「選択中かつ終了」の 4.47（既定）と 2.57（高コントラスト） | `S40` に2ターゲット追加 / `S41` に別バッチ追加 |
| #142 | 分割したタブの終了表示が、どのペインの終了で決まるか | `e2e/specs/S87-tab-exit-across-panes.spec.ts`（新規）+ `scenarios.yml` |

あわせて #144 の残りの完了条件も畳んだ（周1 は文書更新なら振る舞いを変えない）。

- 二重発火の手動確認手順を `.claude/skills/e2e/reference/limitations.md` へ移した。
  **キー割り当てを現在のものへ更新した**（`Cmd+Shift+E` が Gemini、`Cmd+Shift+G` は「前を検索」。
  `Cmd+R` は本番メニューに無いので項目から外した）
- `S36` のコメントがワークスペースではなく `limitations.md` を指すようにした

### 「壊すと赤くなる」ことの確認（全4本）

**`npm run build` を挟んでから spec を単体実行した**（loop.md「壊した実装がビルドに入っていない」）。

| 壊し方 | 赤くなった assert |
|---|---|
| `useTerminal.ts` の `term.write('[プロセスは...]')` を消す | S55「`[プロセスは終了しました（コード 7）]`」（S87 も連動して赤くなる） |
| `.tab-bar__tab.is-exited` / `.tab-bar__exit-badge` の色を `--text-bright` にする | S40 の新2ターゲット 4.47 -> **13.58**。S41 の既定側も同じく赤 |
| `@media (prefers-contrast: more)` に `--status-exited: #f0b8b8` を足す（**周3 の修正の先取り**） | S41 の高コントラスト側 2.57 -> **4.56** |
| `TabBar.tsx` の `leaf.exit` を `every` にする | S87 **ケース1**（1 -> 0） |
| 同じく `some` にする | S87 **ケース2**（0 -> 1） |
| `menu.ts` に `accelerator` 付きの生リテラルを足す | `menu-accelerators.test.ts` の2本 |
| `actionItem()` から `registerAccelerator: false` を消す | 同 1本（**この検査が無いと対象0件で全部素通りする**） |

`--status-exited` の色を直接変える壊し方は採らなかった。**それだと既存の 5.49（状態スロット）も
同時に動いて、新しい2ターゲットが赤くしたのか既存が赤くしたのか分離できない。**
色を読む3箇所のうちテキスト用途の2つだけを別トークンへ差し替えて、新ターゲットだけを狙い撃ちした。

### 検証

`make check`（493 tests）/ `make e2e`（94 passed）/ `make e2e-lint`（FAIL=0）/
`lint-skills.sh`（FAIL=0）。**`make e2e-screenshots` は回していない**（`src/` が無変更で、
画像に写る要素を1つも触っていないため）。`make e2e` は毎回4〜5本 flaky を出したが、
すべてリトライで green。落ちたのは launch のタイムアウト系でマシン負荷。

### 教訓

**1. 「どちら側が red になるか」の予測は外れる。前の周の予測をそのまま信じない。**

前エントリの「次に再開するとき」に **「両方 exit で出る側が現状 red になる」** と書いてあったが、
**実際に red になるのは逆の「片方だけ exit」側**だった。理由は単純で、**ペインで `exit` と打つには
そのペインにフォーカスする必要があり、終了した瞬間そのペインは必ずアクティブ**になる。
だから `tabLeaf(tab).exit` は真になり、現状は「出す」。`every` が求めるのは「出さない」なので、
そこが反転する。「両方 exit」は現状・`some`・`every` の3者とも「出す」で、**何も分離しない**。

書いた本人が実行していない予測は、E2E の期待値としては使えない。

**2. 3つの挙動を分けるには、ケースが2つ要る。**

現状（アクティブ leaf）/ `some` / `every` の3択なので、1ケースでは必ずどれか2つが同じ答えになる。
S87 は「終了ペインがアクティブ」（現状・`some` = 出す / `every` = 出さない）と
「生存ペインがアクティブ」（現状・`every` = 出さない / `some` = 出す）の2つで3者を分離し、
3ケース目（両方終了）で「常に出さない」への倒れ込みを止めている。

**3. 「全項目に一律の向きを要求する」テストには、逆向きの項目を混ぜられない。**

S41 は `for (const name of Object.keys(normal)) expect(high > normal)` の形。
`--status-exited` は高コントラストで**下がる**（前景据え置きのまま背景 #2e2e2e -> #525252 が
明るくなるため）ので、`targets` に足した瞬間に S41 の本来の検査ごと壊れる。
**別バッチで測り、下がっている事実そのものを数値で固定した。**
`toBeCloseTo` 2本に加えて `high < normal` も書いてある（2本が「たまたま同じ値」に化ける事故対策）。

**4. 静的検査は「対象0件で素通りする」壊れ方をする。**

`menu-accelerators.test.ts` の本体は「`accelerator:` を直接書いた項目」を見るが、
menu.ts の項目の大半は `actionItem()` を通るのでこの集合に入らない。
**`actionItem()` 自身が `registerAccelerator: false` を持つことを別の it で見ていないと、
いちばん効く壊れ方（ヘルパから消える）に一度も赤くならない。** パーサ健全性の it も同じ理由。

### 次に再開するとき最初に読むべきこと

- **周2（#142）から始める。** `overview.md` の「3. 周の構成」の表が正
- **周2 でやること**: `tabAllPanesExited(layout)` を `tabYourTurn.ts` と同型の純粋関数として
  `tabPane.ts` に新設 -> `test/unit/tab-pane.test.ts` で固定 -> `TabBar.tsx` の
  `leaf.exit` 4箇所を差し替える
- **周2 の完了は「S87 のケース1 の期待値が `true` -> `false` に反転して green」で観測する。**
  反転しないなら `every` 化が効いていない
- **`const leaf = tabLeaf(tab)` は消さない。** 4箇所すべてを置換すると未使用になり
  `noUnusedLocals: true` で `make check` が落ちるが、`tabLeaf` の import 自体は
  「ペイン名を変更」の編集対象を引くのに使っている（そちらはアクティブペイン依存で正しい）
- **`TabBar.tsx` の該当コメント塊を書き換えること。** 「実装がアクティブ leaf のままなのは
  別 Issue」が、直した瞬間に嘘になる。`tabPane.ts` の `tabRepresentativeLeaf` の
  docstring（「状態はここから引かない」）は**そのまま正しい**ので触らない
- **S87 は #142 を直すと期待値が動く唯一の spec。** 逆に S40 / S78 は `every` 化しても
  green のまま（S40 の exited タブは分割していない単一 leaf、S78 は合成プローブ）
- **周2 のあと #140（#161 の周2）。** 順序を逆にすると置換対象が消えて衝突する

---

## 2026-08-04 - 周2: タブの終了表示を `every` にする（#142）

### 実施内容

| 変えたもの | 内容 |
|---|---|
| `src/renderer/src/tabs/tabPane.ts` | `tabAllPanesExited(layout)` を新設（`tabHasYourTurn` と同型） |
| `src/renderer/src/tabs/TabBar.tsx` | `leaf.exit` 参照4箇所 -> `allExited`。`const leaf = tabLeaf(tab)` を**この描画部からは削除**（別の用途の `tabLeaf` は残る） |
| `test/unit/tab-pane.test.ts` | 8ケース追加（1枚 / 2枚 / 入れ子 / シグナル / **exitCode 0**） |
| `e2e/specs/S87-...` | **ケース1 の期待値を `true` -> `false` に反転**。冒頭の表も「直す前 / いま」に書き換え |
| `README.md` | 分割中の丸と四角で出る条件が違うことを追記 |

### 完了の観測

**周1 で「`every` にすると S87 ケース1 が 1 -> 0 で赤くなる」ことを実測済み。**
その予告どおりに反転して green。`make check` 501 tests（+8）/ `make e2e` 94 passed /
`make e2e-lint` FAIL=0。

S40 が1本 flaky を出したが、失敗理由は `electronApplication.firstWindow` の
15秒タイムアウトで、周1 で足したタブ7枚目の手順とは無関係（同じ run で S64 / S72 /
screenshots も同じ形で flaky）。リトライで green。

### 設計判断

**`tabPane.ts` に置いた**（`tabYourTurn.ts` ではなく）。`tabYourTurn.ts` は
`@shared/agent-status` と `YourTurnJumpDirection` に依存しており、
終了判定はそのどちらも要らない。`architecture.md` の表も `tabPane.ts` を指していた。

**`leaf.exit !== undefined` で判定した（truthy 判定にしない）。** `exit` は
`{ exitCode, signal? }` なので、`exitCode: 0`（正常終了）でもオブジェクト自体は
truthy になり実害は無いが、**「0 は終了していない」と読み違える改変を型で塞ぐ**ため
明示した。unit に専用の1本（`exitCode 0 を falsy として取りこぼさない`）を置いてある。

### 教訓

**同じ「木全体を見る」でも、量化子が違う理由を関数の docstring に書く。**

`tabHasYourTurn` は `some`、`tabAllPanesExited` は `every`。並べると非対称に見えて
「揃えたほうがきれいでは」と思われるが、意味が違うから違う:
あなたの番は「1つでも待っていれば待っている」、終了は「全部終わって初めて終わり」。
**しかも `some` にすると実害が出る**（終了が優先される三分岐なので、あなたの番の
ドットが消える）。この理由を関数側に置いておかないと、次に読む人が「統一」してしまう。

### 次に再開するとき最初に読むべきこと

- **周3（#134 の配色）から始める。** `overview.md` の「3. 周の構成」の表が正
- **周3 は見た目を変える周。計画を確定させる前に `/design-review` を通す**（loop.md の明文）
- **周3 でやること**: `@media (prefers-contrast: more)` に `--status-exited: #f0b8b8` を足す
  （対 #525252 で 4.56）。既定側 `#d47b7b` -> `#e09a9a`（対 #2e2e2e で 5.99）まで上げるかは
  design-review の判断を仰ぐ
- **周3 の完了は S40 / S41 の数値が動いて green になることで観測する。**
  周1 で「`#f0b8b8` を足すと S41 の高コントラスト側が 2.57 -> 4.56 で赤くなる」ことを
  実測済み。**期待値の更新が作業の一部**
- **`styles.css` の `.tab-bar__state-slot--exited` 直上のコメントを直すこと。**
  4.47 を「テキストの 4.5:1 も満たす」と誤記している（**4.47 < 4.5**）
- **S41 の新ブロックは、直したら `targets` 側へ移すか判断する。** 修正後は
  4.47 -> 4.56 で `high > normal` を満たすので一律検査に入れられるが、
  **差が +0.09 しかなく丸め耐性が無い**。spec のコメントにその旨を書いてある
- **`make css-substitution-check` は落ちてよい**（値を意図的に変える周）。
  **`make e2e-screenshots` は必ず回す**（タブの終了色が写る画像があるか判定する）

---

## 2026-08-04 - 周3: `@media (prefers-contrast: more)` の追従漏れを塞ぐ（#134）

### この周は `/design-review` で**周の定義ごと書き直した**

初版の案は「`--status-exited` の値を直す周」だった。5ペルソナのレビューで**前提が3件覆り**、
**「`@media` が面を明るくしたのに前景が追従していない周」**に再定義した。
改訂版の全文は作業用ディレクトリの `proposal-134-rev2.md`（リポジトリには入れない）。

| # | 初版の記述 | 実際 | 指摘 |
|---|---|---|---|
| 1 | 「`@media` は**この1箇所だけ**下げている」 | **最低5箇所**。`--status-your-turn` 6.70 -> 3.86、プロバイダ色3本が選択中タブ上で 2.00〜2.40 | 3人 |
| 2 | 提案 D（強調順序の逆転）は「要判断」 | **確定事項かつ回避不能**。対 #525252 で 4.5:1 を満たす色は L >= 0.5547 で、`#f5a623`（L=0.4681）を必ず超える | 3人 |
| 3 | 提案 B `#e09a9a` | **上げすぎ**。対 --surface-1 で 7.35 = `--text-secondary` 7.01 を追い越す | 4人 |
| 4 | 「3箇所から読まれる」 | **5箇所**。`color: inherit` 経由で `tab-button` / `title-input`（**最明面**）/ `close`（`x`）にも届く | 2人 |
| 5 | C-1 の理由「同時に出ない」 | **誤り**。サイドバーとタブバーは常時同時可視。正しくは「隣接しない」 | 3人 |
| 6 | 周1 で書いた「`state-slot--exited` を S41 に足すな（値を上げても同じ）」 | **偽になる**。同じセレクタが選択状態で別の面に乗る | 3人 |

**さらにレビューが本体を1つ見つけた**: **選択中タブ上の終了マークは高コントラストで 2.57 =
非テキストの 3:1 すら割っていた。** S40 は `against: '.tab-bar'` でしか測っておらず、
しかも対象は非選択のタブ。**S40 も S41 も、選択中タブ上の四角を一度も測っていなかった。**

### 実施内容

| 変えたもの | 内容 |
|---|---|
| `styles.css` の `@media` | `--status-exited: #f0b8b8` と `--status-your-turn: #ffc266` を**セットで**追加 |
| `styles.css:636` のコメント | 4.47 を「4.5:1 も満たす」と誤記していた。**数値を書き直すのではなく削除**し「実測の正は S40」に |
| `styles.css:130` のコメント | 「S40 が対 --surface-tab-active も実測する」も誤り（測っていない）。同じ型の誤記の2件目 |
| `S40` | `あなたの番のドット`（**`--status-your-turn` の契約が0本だった**）と `終了マークの塗り（選択中タブ上）` を追加。**`wcag: 'fail'` の札が腐るのを検出する逆向き assert** も追加 |
| `S41` | `あなたの番のドット` を `targets` に追加。終了色の別バッチを characterization から**正しい向き + 閾値**の検査へ書き換え、`終了マークの塗り（選択中タブ上）` を追加 |
| `design-rules.md` | 耐久性のある規約を5本移した（下記） |
| `README.md` | 「コントラストを上げる」の節に状態マークを追記 |

**実測（周3 の前 -> 後）**

| 対象 | 既定 | 高コントラスト |
|---|---|---|
| 終了したタブの文字・バッジ・マーク（選択中） | 4.47（据え置き） | **2.57 -> 4.56** |
| あなたの番のドット | 7.85（据え置き） | **7.85 -> 9.97** |

### 「壊すと赤くなる」ことの確認

| 壊し方 | 赤くなった assert |
|---|---|
| `--status-your-turn` の @media 上書きを消す | S41「あなたの番のドット が高コントラストで上がっていない」（7.85 -> 7.85） |
| `--status-exited` の @media 上書きを消す | S41 の終了3件すべて（4.47 -> 2.57） |
| 既定の `--status-exited` を `#dc8e8e` にし、**`ratio` だけ更新して `wcag: 'fail'` を残す** | S40 の逆向き assert が2件を名指しで落とした |

### 検証

`make check` 501 / `make e2e` **96 passed**（flaky 2、いずれも launch タイムアウト）/
`make e2e-lint` FAIL=0 / **`make e2e-screenshots-check` PASS=38 FAIL=0（画素差0）**。

`make css-substitution-check` は**落ちてよい周**で、差分は**期待した2行だけ**だった:

```
+     --status-exited: #f0b8b8; (0 -> 1箇所)
+     --status-your-turn: #ffc266; (0 -> 1箇所)
```

**`make e2e-screenshots` は回していない。** `grep -n "exit" e2e/screenshots.spec.ts` = 0件で
`is-exited` が立つ画像が存在せず、撮影レーンは `emulateMedia` を呼ばないので
`@media` の中だけの変更は撮影に届く経路が無い。**予測どおり画素差0で機械的に確認できた。**

### design-rules.md に移した規約（Issue 固有の内容は移していない）

1. `color: inherit` の子孫も、そのトークンの消費者として数える（grep では3件、実際は5件）
2. `@media (prefers-contrast: more)` で面を変えたら、その面に乗る前景を全部数え直す
3. 強調の順序は前景の相対輝度で決まる。**片方だけ直せないことがある**ので状態色は組で動かす
4. コントラスト比の数値を CSS のコメントに書かない（43行あり、機械が守っているものは0）
5. characterization の「満たしていない」札は、腐る向きにも検査する

### 教訓

**1. 「1箇所だけ壊れている」という診断は、原因が構造的なときほど外れる。**

`--status-exited` が高コントラストで割っていたのは事実だが、原因は
「`--surface-tab-active` を明るくして前景を追随させなかった」という**面の側の変更**だった。
**面を変えたら、その面に乗るものは全部同じ壊れ方をする。** 実際に5箇所あった。
1件だけ直して「もう無い」と締めると、事実に反する記録が残る。

**2. 「1周に1軸」は、直せない組み合わせを作ることがある。**

初版は「`--status-exited` だけ直す」を1軸として守ろうとしたが、
対 `#525252` で 4.5:1 を満たす色は相対輝度が必ず `--status-your-turn` を超えるので、
**片方だけ直すと必ず強調順序が壊れる**。1軸を守った結果「一時的に順序が逆のバージョン」を
出荷することになる。**軸は「トークン1つ」ではなく「1つの欠陥」で切る。**

**3. 前の周が予測で書いた注記は、次の周で必ず検算する。**

周1 の S41 に書いた「`state-slot--exited` を一律検査に足してはいけない（周3 で値を上げても同じ）」は
**誤りだった**（選択中タブの上なら面が動くので満たす）。周2 の教訓1（「どちら側が red になるかの予測は外れる」）と
**同じ型が同じ Issue の中で2度目**。**実行していない予測をコメントに書くと、次の人がそれを前提に判断する。**

**4. characterization の札は、良くなる向きにも腐る。**

`wcag: 'fail'` は「いま満たしていない」の記録だが、閾値ループが `fail` を読み飛ばすので、
**値を直して `ratio` だけ更新すると、その項目は緑のまま検査の外に出たきり戻らない。**
是正したのに是正が守られない、という一番気づきにくい壊れ方。逆向きの assert で塞いだ。

### 次に再開するとき最初に読むべきこと

- **周4（#137 ペインヘッダの語）から始める。** `overview.md` の「3. 周の構成」の表が正
- **周4 も「見た目・文言を変える周」なので `/design-review` を通す**（loop.md の明文）
- **#137 は Issue 本文より範囲が広い**（周0 の実測）。`'zsh'` のリテラルは `paneHeader.ts` の
  1箇所ではなく **Renderer に4箇所**（`useTabs.ts` の3箇所を含む）あり、**タブバーにも `zsh` が出ている**。
  同一物を呼ぶ語も3つではなく**4つ**（`menu.ts:245`「新しいシェルタブ」が抜けていた）
- **関門は `launchApp({ config: { shell: '/bin/bash' } })` で作れる**（`buildShellPlan` が
  `config.shell` を `$SHELL` より優先する。**ハーネス改造は不要**）
- **周4 は画像が必ず変わる**（`docs/images/S56-split-pane.png` に `zsh` が写る）。
  周5（#138）の完了条件は「画像差分0枚」なので、**混ぜない**
- **`Contract`（`src/shared/ipc.ts`）を変える可能性がある周**。`architecture.md` の
  「2. Contract 変更」の表を更新すること。採否は周4 の計画ゲートで決める
- **周3 で切り出した5件は `known-issues.md` の 3〜7 に記録済み。** 最終周で GitHub Issue に起こす

---

## 2026-08-04 - 周4: シェルの語を1つの正に集める（#137）

### `/design-review` で案の前提が4件覆った

| # | 初版の記述 | 実際 | 指摘 |
|---|---|---|---|
| 1 | 「claude / gemini はメニューの語とタブの語が一致している。シェルだけが不一致」 | **誤り**。`tabTitle.ts` により新規 claude タブの見出しは `basename(cwd)`（`demo-project`）。`claude` になるのは再開時とペインヘッダだけ。真の非対称は「**エージェントのタブは場所を名乗り、シェルのタブはプログラムを名乗る**」という軸の違い | 2人 |
| 2 | 「Renderer の4箇所のリテラルを置き換える」 | **1箇所で成立しない**。`paneHeader.ts` の `PTY_KIND_LABEL` は静的 Record で spawn 結果に触れられない。**`PaneLeaf` にフィールドが要る** | 3人 |
| 3 | 「`S56-split-pane.png` が必ず変わる」（overview の順序制約3 の根拠） | **画像は1枚も変わらない**。ハーネスは `SHELL: '/bin/zsh'` 固定、開発機の既定も zsh なので表示は `zsh` のまま。**実測で確認**（`e2e-screenshots-check` が FAIL=0） | 1人（保守） |
| 4 | 「『新しいシェル』と『新しいシェルタブ』のどちらに寄せるか」 | **どちらにも寄せない**。壊れているのは2つのメニューの**間**ではなく「+ ▾」の**内部**（`新しいシェル` だけ動詞的で `Claude` / `Gemini` と同格に見えない） | **4人** |

### 実施内容

| 変えたもの | 内容 |
|---|---|
| `src/shared/ipc.ts` | `SpawnPtyResult.shellName?: string`（**`kind === 'shell'` のときだけ**）。claude / gemini は tmux ラップで `plan.command` が `tmux` になるので汎用フィールドにしない |
| `src/main/pty/manager.ts` | `basename(basePlan.command)` を返す（**`plan` ではなく `basePlan`**） |
| `src/renderer/src/tabs/paneTree.ts` | `PaneLeaf.shellName`（`wrappedInTmux` と同型。spawn の瞬間に1回だけ決まる） |
| `src/renderer/src/tabs/useTabs.ts` | **`spawnLeaf` の中でシェルの既定タイトルを決める**（呼び出し側3箇所の `'zsh'` リテラルを消し、正を1箇所に集める） |
| `src/renderer/src/tabs/paneHeader.ts` | `PTY_KIND_LABEL.shell` を動的化。縮退先は `SHELL_FALLBACK_LABEL = 'shell'`（**`zsh` に戻さない**） |
| 同（**a11y の提案 E**） | `paneAccessibleLabel` に役割語（`シェル`）を追加 |
| `src/renderer/src/tabs/TabBar.tsx` | 「+ ▾」の1項目目を `新しいシェル` -> `シェル`（4人一致）。**アプリメニューの「新しいシェルタブ」は縮めない**（直下の「右に分割」もシェルを作るので「タブ」が区別を担う） |
| `e2e/specs/S88`（新規）+ `scenarios.yml` | `launchApp({ config: { shell: '/bin/bash' } })` で**3つの出口**（タブ見出し・ペインヘッダ・aria-label）が追従することを見る |
| `S06` / `S64` / `S69` / `S78` / `screenshots.spec.ts` | `新しいシェル` のロケータ5箇所 |
| `S57` / `S86` | **「この `zsh` はリテラルではなくハーネスの `$SHELL` 由来」** とコメントに明記 |
| `test/unit/pane-header.test.ts` | 7ケース追加（shellName / 縮退 / claude が shellName を無視 / 役割語） |
| `README.md` | 3箇所 |

### a11y の実測が判断を変えた

`say -v Kyoko` で合成して `afinfo` で測った結果:

| 文字列 | 秒 | 分かること |
|---|---|---|
| `zsh` | **1.270** | 英字3文字は**1文字ずつ綴られる**（`ゼットエスエイチ` 1.061 とほぼ同じ） |
| `fish` / `bash` | 0.361 / 0.366 | 1語として読まれる |
| `シェル`（英語音声） | **0.0116** | **完全な無音**（CJK が丸ごと落ちる） |
| `fish、シェル` | **0.824** | **いま出している嘘の `zsh` 単独より短い** |

**「語を『シェル』に揃える」案（提案 B）を却下した決定打がこれ。** 英語音声の VoiceOver では
`シェル` が無音になり、`tabAccessibleLabel` に重複除去が無いのでシェルタブの読み上げ名が
「シェル、シェル」= 無音の二重化になる。

### 「壊すと赤くなる」ことの確認

| 壊し方 | 赤くなった assert |
|---|---|
| `spawnLeaf` のタイトルを `'zsh'` に戻す | S88 出口1「タブ見出し」（`Expected: "bash" / Received: "zsh"`） |
| `paneHeader.ts` の `kindName` を `'zsh'` に戻す | S88 出口2「ペインヘッダ」（`zsh・demo-project`） |

**片方だけ直す壊れ方の両方に、別々の assert が赤くなる**ことを確認した。

### 副産物: S37 の構造的な flaky を見つけて直した

`make e2e` で S37 が落ちた。原因は**私の変更ではなく、S37 自身の潜在バグ**だった。

```
await window.keyboard.press('Meta+d');
await expect(panes).toHaveCount(2);   // タブ2枚 = 分割**前**のペイン数
```

`Meta+d` -> `spawnLeaf` は非同期なので、**新しいペインがマウントされる前に 2 で成立して
素通り**する。遅いと 3 になって落ちる。つまり**両方向に flaky** で、しかも
**通ったときは「分割していない状態」を測っていた**。実測で3回中2回落ちた。
`toHaveCount(3)` に直し、9回連続で安定を確認した。

**loop.md「検査は正しいが、その条件を踏んでいない」の3例目**（S56 の検索バー、
周1 の S41 のコメントに続く）。

### 検証

`make check` 508 / `make e2e` **98 passed**（flaky 1）/ `make e2e-lint` FAIL=0 /
**`make e2e-screenshots-check` FAIL=0（画素差0）**。

### 教訓

**1. 「関門がある」と「関門が効いている」は別。ハーネスの固定値がそれを分ける。**

`S57` / `S86` / `test/unit/pane-header.test.ts` / 撮影の**4レーンが `zsh` を見ていた**のに、
どれも「リテラルが `zsh` である」ではなく「**ハーネスの `$SHELL` がたまたま `/bin/zsh`**」を
検査していた。リテラルに戻しても全部 green のまま。
**ハーネスが固定している値の上では、その値に関する関門は作れない。**
固定を迂回する経路（ここでは `config.shell`）を探すこと。

**2. 語の統一は「1つの語にする」ではなく「同じ容器の中で同じ語形にする」。**

4人が独立に同じ結論を出した。「+ ▾」メニューは容器が `aria-label="新しいタブの種類"` を
既に言っているので項目は裸の名詞（`シェル` / `Claude` / `Gemini`）が正しい。
アプリメニューは直下に「右に分割」（これもシェルを作る）が並ぶので「タブ」の2文字が要る。
**文脈が違うから語が違うのであって、不統一ではない。**

**3. 読み上げは推測せず合成して測れる。** `say -v Kyoko -o out.aiff` + `afinfo` で、
「1語として読まれるか / 1文字ずつ綴られるか」は判別できる（綴り読みは3倍以上に伸びる）。
**この実測が提案 B の却下を決めた。**

### 次に再開するとき最初に読むべきこと

- **周5（#138 ペインヘッダ高のトークン化）から始める。** `overview.md` の表が正
- **周5 は「置換のみ」の周。** `make css-substitution-check` が **PASS** すること自体が完了条件
- **着手前に `known-issues.md` の 8 を判断すること。** 周5 の完了条件「画像差分0枚」は、
  **ペインヘッダが写る唯一の画像（`S56-split-pane.png`）が画素比較の対象外**なので、
  いまのままでは何も担保しない
- **`.pane-header` 由来の 18px は3箇所**（周0 の実測）。`calc(var(--sp-2) + var(--pane-header-height))` は
  展開後に現在と文字列一致するので `css-substitution-check` が PASS する
- **`.notice-banner__icon` の 18px は別物**（#138 の完了条件「styles.css に 18px が残っていない」は達成不能。
  「`.pane-header` 系の規則に残っていない」へ読み替える）
- **周5 は見た目を変えない周なので `/design-review` は通さない**（起動条件は design-review の SKILL.md が正。
  「値を変えずトークンへ置換するだけ」は該当しない）

---

## 2026-08-04 - 周5: ペインヘッダ高のトークン化（#138。置換のみ）

### 実施内容

`.pane-header` 由来の `18px` リテラル3箇所を `--pane-header-height` に畳んだ。
**`--bar-height`（タブバー）とは別のトークンにした** — 用途が違い、揃える理由が無い
（ヘッダは1ペインぶんの帯、タブバーはウィンドウの帯）。値を共有すると片方を
動かしたときにもう片方が黙って動く。

| 箇所 | 変更 |
|---|---|
| `:root` | `--pane-header-height: 18px;` を宣言 |
| `.pane-header` | `flex: 0 0 18px` / `height: 18px` -> `var(--pane-header-height)` |
| `.pane-header ~ .terminal-search` | `calc(var(--sp-2) + 18px)` -> `calc(var(--sp-2) + var(--pane-header-height))` |
| `test/unit/css-tokens.test.ts` | 4ケース追加 |

**`.notice-banner__icon` の `18px` は畳まなかった。** 帯の高さとは無関係で、たまたま同じ値。
**たまたま同じ数値というだけの箇所を同じトークンに畳むと、意味の無い依存が生まれる。**
Issue 本文の完了条件「`styles.css` に 18px が残っていない」は**達成不能**なので、
「`.pane-header` 系の規則に残っていない」へ読み替えた。その判断も unit で固定してある
（`.notice-banner__icon` に 18px が**残っていること**を assert する）。

### 検証（この周の要点）

**`make css-substitution-check` が PASS することが完了条件そのもの。**
ただし既定の比較先は `origin/main` で、作業ツリーには周1〜4 の未コミット変更
（周3 で値も変えている）が乗っているため、そのままでは周3 の差分で落ちる。

**`git stash create` で作業ツリーのスナップショットをコミットオブジェクトとして作り、
`REV=<sha>` で比較した。** 出力は `[PASS] トークンを展開すると <sha> の CSS と一致する`。
**周5 の変更だけを対象に「値が1つも変わっていない」ことを証明できた。**

| 検証 | 結果 |
|---|---|
| `make check` | 512 tests（+4） |
| `make e2e` | 96 passed（flaky 3。すべてリトライで green） |
| `make e2e-screenshots-check` | **FAIL=0（画素差0）** |
| `make css-substitution-check REV=<スナップショット>` | **PASS** |

### 「壊すと赤くなる」ことの確認

| 壊し方 | 赤くなった assert |
|---|---|
| `.pane-header` を `18px` のリテラルに戻す | `.pane-header の高さが --pane-header-height を参照している` |
| 検索バーの `top` だけリテラルに取り残す | `ヘッダの下へ検索バーを逃がす top も同じトークンを参照している` |

**`css-substitution-check` はこの2つを検出しない**（値は同じなので PASS する）。
置換の正しさを証明するのはあちら、**リテラルへの逆戻りを止めるのは unit** という分担。
**片方だけでは守れない。**

### 教訓

**`make css-substitution-check` は「置換が正しいこと」しか言わない。**

このスクリプトはトークンを展開して比較対象の CSS と文字列一致するかを見るので、
**次に誰かが `var(--pane-header-height)` を `18px` に書き戻しても、展開結果は同じで PASS する。**
「トークン化した」という状態を守るのは unit の役目で、両方要る。
`--bar-height` に対して既に同じ形の unit（`.tab-bar` / `.notice-list`）があったのは、
おそらく同じことに気づいた人がいたから。

### 次に再開するとき最初に読むべきこと

- **周6（#132 `Cmd+J` をペインまで着地させる）から始める**
- **周6 は見た目を変えない周**（当たり判定・フォーカス移動の修正）なので `/design-review` は通さない
- **`e2e/scenarios.yml` と S68 / S78 / S63 の4箇所にある「成功経路はハーネスで作れない、
  解くのは #83」という注記は古い**（#83 は CLOSED、`setAgentEntries()` が実装済み）。
  **注記の是正も同じ周に含める**（`known-issues.md` の 1 に記録済み）
- **S63 の「履歴 resume で `agentSessionId` を決め打つ」手法と `setAgentEntries()` を
  組み合わせれば実タブを作れる**
- 現状の関門は「該当タブが無い」側（S68）だけで、**着地の成功経路は unit にも E2E にも0本**

---

## 2026-08-04 - 周6: `Cmd+J` をペインまで着地させる（#132）

### 実施内容

| 変えたもの | 内容 |
|---|---|
| `src/renderer/src/tabs/tabYourTurn.ts` | `findNextYourTurnTab`（tabId を返す）-> **`findNextYourTurnPane`（`PaneLocation` を返す）** |
| `src/renderer/src/App.tsx` | `setActiveTabId(target)` -> **`focusPaneLocation(target)`**（通知クリック・タスク一覧クリックと同じ経路） |
| `test/unit/tab-your-turn.test.ts` | 9ケース -> 13ケース（ペイン粒度の4ケースを追加） |
| `e2e/specs/S89`（新規）+ `scenarios.yml` | **成功経路の関門**（それまで unit にも E2E にも0本だった） |
| `S68` / `S78` / `S63` / `scenarios.yml` | **古い注記4箇所を是正**（`known-issues.md` の 1） |
| `README.md` | ショートカット表 |

### 設計判断: タブの環ではなくペインの環にした

`findNextYourTurnTab` は「タブの並びを環とみなして次を探す」形だった。
最小の修正は「見つかったタブの中で最初に待っている leaf も返す」だが、**ペインの環にした**。

理由は**タブが1枚しか無い場合が直らない**から。タブ単位の探索は
`(startIndex + step * i) % length` を回すので、`length === 1` だと1周目で自分自身に戻り、
`setActiveTabId` が no-op になる。**「1タブを分割して片方が待っている」は分割の主用途そのもの**
なのに、そこで `Cmd+J` が何もしていなかった。

ペインの環（タブの並び × `flattenPaneTree` の並び）にすると、この場合も別のペインへ動く。
unit にその1本（`タブが1枚しか無くても、別のペインへ動く`）を置いてある。

`tabHasYourTurn`（タブバーの状態ドット）は `some` のままにした。
**同じ木を見ていても、問いが違えば返す粒度も違う**（「そのタブが待っているか」と
「どのペインが待っているか」）。

### 通知の文言は変えなかった（意図的）

ペイン粒度になったので「あなたの番の**タブ**はありません」を「ペイン」に直したくなるが、
**この周では変えていない**。文言の変更は `/design-review` の起動条件（「画面に出る文言を変える」）に
該当し、1語のために5ペルソナを回すのは釣り合わない。**現在の文言は嘘にもなっていない**
（待っているペインが1つも無ければ、待っているタブも無い）。
`known-issues.md` に判断として記録した。

### 「E2E で作れない」という注記が4箇所とも古かった

S68 / S78 / S63 と `scenarios.yml` が「偽 CLI の `agents.json` の sessionId は
アプリが起動するセッションの agentSessionId と独立しているので成功経路を作れない。
解くのは #83 / #120 D-2」と書いていたが、**#83 は CLOSED で `setAgentEntries()` は実装済み**。

S63 が使う「履歴 resume なら agentSessionId を決め打てる」（`11111111-1111-4111-8111-111111111111`）と
組み合わせると、**アプリが実際に起動したセッションの UUID を偽 CLI の出力へ書き戻せる**。
S89 がその実例で、4箇所とも「もう作れる」へ書き換えた。

### 「壊すと赤くなる」ことの確認

`focusPaneLocation(target)` を `api.setActiveTabId(target.tabId)`（= 直す前の振る舞い）に
戻したところ、S89 が

```
Expected pattern: /is-active/
Received string:  "terminal-pane terminal-pane--split"
```

で赤くなった。**タブは切り替わるがペインは動かない**という、まさに #132 の症状。

### 検証

`make check` 515 / `make e2e` **99 passed**（flaky 1）/ `make e2e-lint` FAIL=0。
`make e2e-screenshots` は回していない（DOM の構造も CSS も触っていない。
実際に `e2e` の撮影レーンは全 green）。

### 教訓

**「このハーネスでは作れない」は、書いた時点の事実であって、いまの事実ではない。**

4箇所が口を揃えて同じ制約を書いていたので、読む側には「調べ尽くされた結論」に見える。
しかし**その制約を解く Issue（#83）は既に CLOSED**で、解決策（`setAgentEntries()`）は
リポジトリの中に実装済みだった。**注記の数は正しさの証拠にならない**（同じ文が
コピーされて増えただけ）。`known-issues.md` の 1 に「制約の記述と、それを解く Issue の
状態が紐づいていない」として記録済み。**この周がその2件目の実例**（1件目は `limitations.md` の `ownedByApp`）。

### 次に再開するとき最初に読むべきこと

- **周7（#158 `Cmd+W` に回収不能ペインの確認を通す）から始める**
- **周7 は見た目を変えない周**（確認ダイアログの発火条件）なので `/design-review` は通さない
- **完了条件**: `test/unit/` が「1 leaf・tmux+gemini / tmux+claude / tmux 無し」の3ケースを固定。
  判定が `requestCloseTab` と二重定義になっていないこと
- **周7 -> #157（#161 の周7）の順**。`App.tsx` / `CloseTabConfirmDialog.tsx` の
  古いコメント3箇所は #158 の PR に畳める

---

## 2026-08-04 - 周7: `Cmd+W` に回収不能ペインの確認を通す（#158）

### 実施内容

| 変えたもの | 内容 |
|---|---|
| `src/renderer/src/tabs/closeTabCopy.ts` | **`needsCloseConfirmation(closingLeaves)` を新設**。判定を1箇所に集めた |
| `src/renderer/src/App.tsx` | `requestCloseTab` がその関数を使う。`case 'close-pane'` は**最後の1枚なら `requestCloseTab` へ合流**させる |
| `test/unit/close-tab-copy.test.ts` | 7ケース追加（完了条件が名指しした「1 leaf」の3ケースを含む） |
| `e2e/specs/S90`（新規）+ `scenarios.yml` | **偽 tmux レーンで実際に `Cmd+W` を押す** |
| `App.tsx` / `CloseTabConfirmDialog.tsx` の古いコメント | 「2つ以上の PTY を一度に閉じるときだけ」-> 実態へ |
| `README.md` | 確認ダイアログが出る2つの条件を明記 |

### 設計判断: 新しい文言を1つも作らなかった

`Cmd+W` の経路を**既存の `requestCloseTab` へ合流させる**形にしたので、
**ダイアログも文言も既存のものをそのまま使う**。新しい文言を作らなかったので、
この周は `/design-review` の起動条件（「画面に出る文言・ラベル・空状態を変える」）に
該当しない。

**複数ペインのうち1枚だけを閉じる場合は対象外にした。** Issue 本文も
「こちらはタブを閉じる操作ですらないので `requestCloseTab` の設計対象外」と
書いており、完了条件が名指しした3ケースはすべて「1 leaf」。
ここに手を出すと**「ペインを閉じます」という新しい文言が必要**になり、
design-review が要る。`known-issues.md` に切り出した。

### 引数の契約を「実際に閉じるペイン」にした

`needsCloseConfirmation(closingLeaves)` は「その操作で**実際に閉じる**ペイン」を受け取る。
タブごと閉じるなら木の全 leaf、ペイン1枚なら その1枚。
**この契約にしておけば、複数ペインの1枚を閉じる場合も同じ関数で判定できる**
（次にそこへ手を入れる人が、判定を書き足さずに済む）。unit に契約そのものの1本を置いた。

### 「壊すと赤くなる」ことの確認

`case 'close-pane'` の合流を消して直す前の振る舞いに戻したところ、S90 が
`expect(locator).toBeVisible() failed / element(s) not found`（ダイアログが出ない）で赤くなった。

### 検証

`make check` 522 / `make e2e` **98 passed**（flaky 3。**3件とも
`electronApplication.firstWindow` の15秒タイムアウト**でマシン負荷。
S56 は `Cmd+W` を含む spec なので念のため失敗理由まで確認した）/ `make e2e-lint` FAIL=0。

### 教訓

**「唯一の入口」と書いてあっても、別経路が生えていないかは別に確かめる。**

`requestCloseTab` の JSDoc は「タブを閉じる唯一の入口」と明記し、
x ボタンとメニューの両方を合流させていた。**にもかかわらず `Cmd+W` は通っていなかった。**
`close-pane` は名目上「ペインを閉じる」操作なので、**タブを閉じる入口の一覧を
数えるときに視界へ入らなかった**。

見つけ方は単純で、**その関数を呼ぶ側ではなく、閉じられる側（`closeTab`）の
呼び出し元を数える**。`closeActivePane` が直接呼んでいることがすぐ分かる。
**入口を数えるときは、入口の名前ではなく出口から辿る。**

### 次に再開するとき最初に読むべきこと

- **周8（#133 異常終了を Dock に出す）から始める**
- **周8 の設計判断は未決**（`architecture.md` の「設計判断履歴」）。`severityForExit` を
  `src/shared/` へ移すか、Main 側に判定を複製するか。**移すのが自然だが
  `test/unit/notices.test.ts` の import も動く**
- **`dock.bounce` は Playwright から観測できない**（`architecture.md` の技術的制約）。
  関門は純粋関数の unit までで、呼び出し自体は手動確認として記録する
- **`manager.ts` の `onExit` は Main 内で `exitCode` を持っている**ので、
  IPC 経路の新設は不要（周0 の実測での訂正）
- `src/renderer/` は Main から見えない（`tsconfig.node.json` の `include` は
  `src/main` / `src/preload` / `src/shared` のみ）。**これが `severityForExit` を
  そのまま使えない理由**

---

## 2026-08-04 - 周8: 異常終了を Dock に出す（#133）

### 実施内容

| 変えたもの | 内容 |
|---|---|
| **`src/shared/pty-exit.ts`（新規）** | `isAbnormalExit()` / `shouldBounceOnExit()` |
| `src/renderer/src/lib/notices.ts` | `severityForExit` が `isAbnormalExit` に委ねる（判定を持たない） |
| `src/main/pty/manager.ts` | `proc.onExit` で `app.dock.bounce('informational')` |
| `test/unit/pty-exit.test.ts`（新規） | 9ケース |
| `limitations.md` | 手動確認の4項目 |
| `README.md` | 通知の節に1段落 |

### 設計判断: `severityForExit` を移さず、判定だけを切り出した

`architecture.md` が未決にしていた選択（`src/shared/` へ移す / Main に複製する）に対して、
**第3の答え**を採った。

移すべきは「異常終了か」という**事実**であって、`NoticeSeverity`（`'info' | 'error'`）という
**通知バナーの表現**ではない。Main は severity を必要としない。
そこで `src/shared/pty-exit.ts` に `isAbnormalExit()` だけを置き、
`severityForExit` は「異常 -> エラー」という対応だけを持つ薄いラッパーとして Renderer に残した。

**1つの事実、2つの表現。** `test/unit/notices.test.ts` の import も動かずに済んだ。

### 設計判断: アプリ側の kill では鳴らさない

`proc.onExit` の中で `entries.get(ptyId)` が `undefined` なのは、
**アプリ側が `pty:kill` で殺した場合**（`ptyKill` ハンドラが先に `disposeEntry` する）。
既存コードはそこで Renderer への通知も止めていたので、**bounce をその `if` の中に置くだけで
「タブを閉じた」「アプリを終了した」で鳴らない**ようになる。
新しいフラグを増やしていない。手動確認の項目4 がこれを見る。

### 「壊すと赤くなる」ことの確認

| 壊し方 | 赤くなった assert |
|---|---|
| `signal !== 0` の判定を `signal !== undefined` にする（`signal: 0` を異常扱い） | `pty-exit` の2本 + **`notices.test.ts` の1本**（= 正が1つであることの実証） |
| `windowFocused` のガードを外す | `pty-exit` の2本（「見ている最中は鳴らさない」「2つの条件は AND」） |

**1つの壊し方が2つのファイルのテストを同時に赤くした**のは、判定の正が1つになった証拠。

### 検証

`make check` **531 tests** / `make e2e` **98 passed**（exit=0。flaky 3 はすべて
`electronApplication.firstWindow` の15秒タイムアウト。新設の S90 も1度 flaky に出たが
理由は同じ launch タイムアウトで、spec の設計とは無関係）。

### 教訓

**「共有へ上げる」ときは、上げる単位を「事実」まで削る。**

`architecture.md` は「`severityForExit` を `src/shared/` へ移すのが自然だが、
Renderer 専用だった関数を共有に上げるのは影響範囲の判断が要る」と書いて判断を保留していた。
実際に必要だったのは**関数そのものではなく、その中の1行の述語**だった。
表現（severity の語彙）まで一緒に上げようとするから影響範囲が読めなくなる。
**共有に上げるのは述語、残すのは表現。**

### 次に再開するとき最初に読むべきこと

- **周9（#135 ターミナル面のコンテキストメニュー）から始める**
- **周9 は見た目・状態表現を変える周なので `/design-review` を通す**
- **実装形式が未決**（`architecture.md` の設計判断履歴）。Main の `Menu.popup()` は
  **DOM に出ないので Playwright から中身を検証できない**。完了条件「E2E で検証されている」と
  両立するのは Renderer の HTML メニュー。ただし macOS の作法としてはネイティブが正しい
- **`contextmenu` はアプリ全体で0件**（周0 の実測）。`Menu.popup()` を採るなら IPC が1本要る
- **周10（実機確認3件の手順書）が最後。** #148 / #151 / #154。
  `limitations.md` には周7・周8 で既に2件の手動確認節を足してあるので、同じ形で書く

---

## 2026-08-04 - 周9: ターミナル面のコンテキストメニュー（#135）

### `/design-review` で案の中核が2件覆り、提案が A から B へ反転した

| # | 初版の記述 | 実際 | 指摘 |
|---|---|---|---|
| 1 | 「右クリックはブラウザ既定の何も起きない状態」「`rightClickSelectsWord` は既定 false」 | **どちらも誤り**。既定は `isMac`（= このアプリでは **true**）。xterm は `contextmenu` に `rightClickHandler` を張り、隠し textarea をカーソル下へ移動 -> `focus()` -> `value = selectionText` -> `select()` している。**これはネイティブの Copy を効かせるための仕掛け** | **4人** |
| 2 | 「B（ネイティブ）は DOM に出ないので E2E で検証できない」 | **誤り**。`Menu.prototype.popup` は JS 側にあるので `app.evaluate()` から差し替えられ、`items` も `click()` も取れる。**macOS レビュアーが実機で `CAPTURED=true` / `CLICK_INVOKED=true` を出し、こちらでも独立に再現した** | **4人** |
| 3 | 「新しい能力を1つも作らずに埋まる」 | **A-1 を採る限り偽**。`AppAction` は対象ペインを運ばず `close-pane` / `rename-active-pane` / `split-pane` はすべて**アクティブなペイン**へ向かう。**4分割で右下を右クリックして「閉じる」を選ぶと左上の claude が死ぬ** | **4人** |
| 4 | 「CSS も `.tab-bar__new-menu` / `--menu-item` がある」 | `--menu-item` というトークンは存在しない。`.tab-bar__new-menu` は `top: 100%; left: 0` でトリガーに固定アンカーされており、カーソル位置に出す用途には使えない | 3人 |
| 5 | 項目6つ（分割・閉じる・最大化・名前・消去・検索） | **コピー / ペーストが1つも無いのが最大の穴**。ターミナルで右クリックする理由の第1位。Terminal.app の nib を実測すると `_contextualMenuForSelection` に Copy / Paste が入っている | **4人** |

**提案 B（ネイティブ `Menu.popup()`）を採った**（3対2）。A の反対理由が具体的だった:

- `.terminal-stack` / `.pane-split__cell` の `overflow: hidden` で**切られる**（3人）。
  人がターミナルでクリックするのは主にプロンプト行 = 下端
- DOM フォーカスを奪うと **DECSET 1004 が立っている端末に `ESC [ O` が飛ぶ**。
  tmux / vim / claude は 1004 を立てるので、**メニューを開いただけで子プロセスに
  「ウィンドウが非アクティブになった」と嘘をつく**
- コピーは `term.element` の `copy` リスナ経由なので、**フォーカスをメニューへ移すと死ぬ**。
  自前で書くとペーストが **bracketed paste を通らず、複数行が行ごとに実行される**
- メニューを開いている間**グローバルショートカットが素通りする**（3人）。`Cmd+W` でペインが閉じ、メニューだけ宙に浮く
- Escape が xterm に漏れて**走行中のエージェントを止める**

### 実施内容

| 変えたもの | 内容 |
|---|---|
| **`src/shared/context-menu.ts`（新規）** | 項目表を決める純粋関数。**Main / Renderer の両方から見える場所** |
| `src/shared/ipc.ts` | `IpcSend.contextMenuShow` + `RendererApi.menu.showContextMenu`（`menuPaneCount` と同型） |
| `src/preload/index.ts` | 素通し1本 |
| `src/main/menu.ts` | 受けて `MenuItemConstructorOptions` に変換し `Menu.popup({ window })`。**座標は渡さない**（Electron がカーソル位置に出す。端での反転も OS がやる） |
| `src/renderer/src/terminal/useTerminal.ts` | `getContextMenuState()`（マウス報告中か / 選択があるか） |
| `src/renderer/src/terminal/TerminalPane.tsx` | `onContextMenu` |
| `src/renderer/src/tabs/PaneTreeView.tsx` | `paneCount` を渡す |
| `test/unit/context-menu.test.ts`（新規） | 12ケース。**menu.ts をテキストで読んで語とキーの一致も検査** |
| `test/unit/menu-accelerators.test.ts` | 動的ラベルの項目を許可リストへ（**この関門が正しく発火した**） |
| `e2e/specs/S91`（新規）+ `scenarios.yml` | 配線 |
| `README.md` | 1段落 |

### 項目（design-review の合意）

```
コピー / ペースト        ← クリップボードが先頭（右クリックする理由の第1位）
──
右に分割 / 下に分割
──
画面を消去 / ターミナル内を検索
──                      ← ここから下は分割中だけ
ペインを最大化 / ペイン名を変更...
──
ペインを閉じる           ← 破壊的な操作は最後。カーソルの真下に置かない
```

**1ペインのタブでは「ペイン」という語を1つも出さない。** ペインヘッダとアクセント線は
分割中しか出ないので、1枚のときは「ペイン」に指示対象が画面上に無い。
「最大化」は1枚では押しても画面が1pxも動かない（「何も起きないまま終わらせない」に反する）ので出さない。
「閉じる」は1枚だと実際にタブが閉じるので**語もそう出す**（`updateCloseTabLabel` と同じ形）。

**語はアプリメニューと一字一句そろえた。** 右クリックで覚えた語がメニューバーで同じなら、
そこでキーを見つけられる。**これは機械で守れる**ので、`menu.ts` をテキストとして読んで
突き合わせる unit を置いた（語とアクセラレータの両方）。

### マウス報告モード中は出さない

`term.modes.mouseTrackingMode !== 'none'` なら `preventDefault()` すらせず端末へ譲る。
vim（`set mouse=a`）/ htop / **既定で tmux にラップされるエージェントのタブ**は
右ボタンを自分で使う（tmux 3.x の `MouseDown3Pane` は既定で `display-menu`）。
**これは例外ケースではなく主要な経路**なので、ゲート無しで出すと
「いちばん使う画面でいちばん壊れる」。

### 「壊すと赤くなる」ことの確認 — **1本目の assert は空振りだった**

| 壊し方 | 結果 |
|---|---|
| `onContextMenu` をまるごと消す | S91 が red（popup が0回） |
| **`onActivate?.()` の1行だけ消す** | **初版は green のまま素通りした** |

**原因**: ターミナル面の上で測っていた。xterm 自身の `rightClickHandler` が
隠し textarea を `focus()` するので、`onFocusCapture` -> `onActivate` が走り、
**アプリ側の実装を消しても結果が同じ**になる。

**直し方**: 測る場所を**ペインヘッダ**に変えた。`.pane-header` は `.xterm` の外なので
xterm は発火せず、そこで初めて `onContextMenu` の中の `onActivate?.()` が判別できる。
変更後は1行消すと `Received string: "terminal-pane terminal-pane--split"` で red になった。

**loop.md「検査は正しいが、その条件を踏んでいない」の4例目。**
しかも今回は**設計をレビューで教えてもらった箇所**（macOS レビュアーが
「ヘッダや padding 帯の上では xterm が発火しないので、そこだけ A-2 に化ける」と
指摘していた）が、そのまま**関門の作り方**にも効いた。

### 検証

`make check` **543 tests** / `make e2e` **99 passed**（flaky 3。すべて launch タイムアウト）/
`make e2e-lint` FAIL=0 / `make e2e-screenshots-check` **FAIL=0（画素差0）** /
`lint-skills.sh` FAIL=0。

**画像は1枚も変わらない**（撮影レーンは右クリックしない）。

### 教訓

**1. 「E2E で検証できない」を設計判断の主軸にしない。まず本当に検証できないか試す。**

初版は「ネイティブは E2E で見えない」を根拠に、HIG 的に正しい選択肢を捨てようとしていた。
実際は `Menu.prototype` に生えている JS のメソッドを差し替えるだけで、
**項目も `click()` も取れた**（20行のプローブで確認できる）。
検証手段の有無で設計を決めるなら、**その有無を実測してから**にする。
これは周6 の「E2E で作れないという注記は古い」と**同じ型の3例目**。

**2. 「既存の仕組みを流すだけ」は、対象が暗黙の場合に成立しない。**

`AppAction` は「アクティブなペイン」に向かう。右クリックは「押した場所」の操作なので、
**両者が一致する保証が無い**。しかも右クリックでは `onFocusCapture` が発火しないので、
黙って別のペインが閉じる。**「新しい能力を作らない」は「対象の指定も既存のままでよい」を
意味しない。**

**3. 関門を作る場所は、実装が唯一の原因になる地点を選ぶ。**

xterm も同じ副作用（フォーカス移動）を持っているので、ターミナル面で測ると
アプリ側の実装が消えても green になる。**「他に同じ結果を生む主体がいないか」を
先に数える。** ここでは xterm 自身がその主体だった。

### 次に再開するとき最初に読むべきこと

- **周10（実機確認3件の手順書。#148 / #151 / #154）が最後**
- `limitations.md` には周7・周8・周9 で既に手動確認の節が3つある（二重発火 / Dock バウンス /
  この周は E2E で見られたので節は増やしていない）。**同じ形で書く**
- **周9 で切り出した3件は `known-issues.md` の 13〜15。**
  とくに **13（リンククリックの出口）は P1 で、#135 より効く**（25〜90手/日）
- 最終周のあと、`known-issues.md` の 3〜15 を GitHub Issue に起こす
  （`promote-known-issues.md`）

---

## 2026-08-04 - 周10: 実機確認3件の手順書（#148 / #151 / #154）

### 実施内容

`.claude/skills/e2e/reference/limitations.md` に「実機確認の手順書」の節を足した。
**コードは1行も変えていない**（3件とも実装は済んでおり、未確認なのは実機の経路だけ）。

**なぜ自動化しないのかを3件それぞれ別に書いた。** ここを混ぜると
「まとめて自動化できないもの」という雑な括りになり、次に読む人が
「本当に無理なのか」を毎回調べ直すことになる。

| # | 自動化できない理由 |
|---|---|
| #148 | **OS の支援技術を起動する必要がある。** S37 が担保するのは「読み上げ対象の DOM が存在し、出力がテキストとして入っている」まで |
| #151 | **通知はアプリの外にある。** Renderer 側の受け口は S63 が担保済みで、**未検証なのは Main 側の前半**（`notify/index.ts` の `onClick` と `poller.ts` の `focusSession()`） |
| #154 | **隔離が原理的に効かない。** tmux サーバはプロセス横断の資源で、一時 HOME では分離できない（#121 で「作らない」と決着済み） |

各件について「何を操作して何を見るか」の表を書いた。#151 は**壊れ方が1つしかない**
（`targetWindow` が未設定・破棄済みだと黙って return する）ので、
最小化・フルスクリーンなど `restore()` の経路が違う状態を並べてある。

### 未実測の断定を2箇所訂正した

#154 が指摘していた「実測日の併記無しに断定している」箇所を、そのまま直した。

| 箇所 | 直した内容 |
|---|---|
| `README.md`（tmux の節） | 「claude なら戻れる」に、**名前が一致することまでしか確かめていない**と明記 |
| `/terminal` の `reference/pty-pitfalls.md` | 同上（`-A` でアタッチし直せる**はず**、**未実測**） |

**戻れるかどうかは、この周では確かめられない**（実機が要る）。
だが**「確かめていない」と書くことは今できる**。#121 の 5 番が潰したのと同じ型
（未実測の断定が3箇所に伝播していた）を、今度は伝播する前に止めた。

### 検証

`make check` 543 tests / `make e2e` 98 passed（exit=0。flaky 4 はすべて launch タイムアウト）/
`lint-skills.sh` FAIL=0。

### 教訓

**「実機でしか確かめられない」と「確かめなくてよい」は違う。**

3件とも「自動化できない」で止まったまま、#20 / #25 / #56 の worklog が
**繰り返し「未消化」と記録していた**。手順が無いと、実施しようとした人が
毎回ゼロから手順を組み立てることになり、結局やらない。
**手順を書くところまでがエージェントの仕事で、実施は人の仕事**という分担にした。

**そして、実施を待たずに今できることが1つあった** — 未実測の断定に
「未実測」と書くこと。これは実機を必要としない。

### 次に再開するとき最初に読むべきこと

- **#160 の周は全部終わった。** 対象10件すべてが close 可
- **残っているのは2つ**:
  1. 実機確認3件（#148 / #151 / #154）の**実施**。手順は `limitations.md` にある。**人が行う**
  2. `known-issues.md` の 3〜15（13件）を GitHub Issue に起こす（`promote-known-issues.md`）
- **とくに `known-issues.md` の 13（ターミナル内リンクのクリックで Electron の窓が開く）は P1。**
  周9 の design-review で見つかったもので、**#135 より効く**（25〜90手/日）
- **#161（P3 の12件）は未着手。** `overview.md` の「順序の制約」のうち
  2（#142 -> #140）と 4（#158 -> #157）は**こちら側が終わったので解けている**
