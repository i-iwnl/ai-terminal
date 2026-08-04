# Known Issues

実装中に発見された未解決のバグ・先送りした課題。
詳細な観察記録は `worklog.md` を参照。

**⛔ この Issue のループの中で新規 GitHub Issue を立てない。** 見つけたものはここに書くだけにする。
切り出したくなったら、#179 の周を1つ増やす。起票は `/workspace-plan promote-known-issues` を明示的に呼んだときだけ。

---

## 1. Issue #165 本文の現状認識が古い（着手前に訂正済み）

### 症状

#165 の対処方針が「`contrast.ts` に『border を、自分の背景と比べる』オプションを足すか、`against` を明示できるようにする」と書いているが、
**`ContrastTarget` には既に `against?: string` と `againstColor?: string` の2つが実装されている。**

### 原因

`.claude/workspace/issue-160/known-issues.md` の 4番から起票された時点の認識がそのまま残っている。
`against` / `againstColor` はそれ以前から `measureContrast` にあり、S40 も `選択中セグメントの塗り`・`あなたの番のドット` などで実際に使っている。

真の欠落は API ではなく **S40 の計測対象**で、`.tab-bar__tab--shell` などの `border-top-color` を
`against` 無しで登録しているため、常に親 `.tab-bar`（`--surface-1`）と比べられていた、という1点。

### 影響範囲

- 周1 のスコープ。ハーネスの API 追加は不要になり、spec の計測対象追加だけで済む

### 対処方針

- [x] `architecture.md` の設計判断履歴に訂正を記録した
- [ ] 周1 の完了時に #165 へコメントで書き戻す

### 優先度

P2

### ステータス

対処済み（記録の訂正のみ）

---

## 3. 除外リストに書かれた「非決定の原因」が誤っていた（周1 で判明・是正済み）

### 症状

`scripts/verify-screenshots.mjs` の `KNOWN_NONDETERMINISTIC` は、`S56-split-pane.png` を
画素比較から外す理由を「zsh が部分行マーカー（反転表示の `%`）を出す。描画の
アーティファクトではなく**実際の端末内容**」と記録していた。この書き方は
**「シェルの出力そのものが非決定なので待っても無駄」**と読める。

**その原因は誤りだった。** 8回ずつ撮って比べた結果（2026-08-04 実測）:

| 条件 | 8枚が何種類になったか |
|---|---|
| 現状のまま | 2種類 |
| `.zshrc` に `PROMPT_EOL_MARK=''` を足してマーカーを消す | **2種類のまま** |
| 撮影前の待ち合わせを強くする | **1種類** |

正体は素朴な競合で、**待てば決まるものだった**。既存の待ち合わせ
`toContainText(/[$%#>]/)` は「画面のどこかにプロンプト文字がある」しか見ないため、
2枚目のペインの描画が先頭行に落ち着く前に撮れる回があった。

### 原因（判明している場合）

**誤った原因の記録は、その項目を「直せないもの」として永続化する。**
`verify-screenshots.mjs` は「ここに足すときは、非決定の原因を実測で突き止めてから書くこと」と
定めていて、その規約自体は守られていた（3回撮って1回出た、という実測記録がある）。
だが**観測した現象（`%` が出る）と原因（待ちが足りない）を取り違えていた**。
規約が要求していたのは「実測」までで、「なぜ待っても無駄なのか」の検証は求めていなかった。

### 影響範囲

- `S56-split-pane.png` が SKIP されていた期間、**`docs/images` 13枚のうち
  ペインヘッダが写る唯一の画像に画素の関門が無かった**（#169 の本体）
- 同じ取り違えは、今後 `KNOWN_NONDETERMINISTIC` に足す項目でも起こりうる

### 対処方針

- [x] 待ち合わせを強くして SKIP を外した（`e2e/screenshots.spec.ts` の S56）
- [x] `verify-screenshots.mjs` のコメントに、**「なぜ待っても無駄なのか」まで疑うこと**を
      教訓として書き足した
- [ ] 周1 の完了時に #169 へコメントで書き戻す

### 優先度

P2

### ステータス

対処済み

---

## 2. `make e2e-screenshots` の直後に `make e2e-screenshots-check` を回すと、比較元が古い

### 症状

`verify-screenshots.mjs` の `--dir` 既定は `e2e/.screenshots-out` で、これは `make e2e` が書く先。
`make e2e-screenshots` は `docs/images/` に直接書く。
**`make e2e-screenshots` だけを回して `make e2e-screenshots-check` を叩くと、`e2e/.screenshots-out` に残っている前回の撮り立てと比較する**ことになる。

### 原因（判明している場合）

2つのレーンで出力先が違う（`Makefile` の `SCREENSHOTS_SCRATCH` と `e2e-screenshots` ターゲット）。
CLAUDE.md は「`make e2e`（または `make e2e-screenshots`）で撮った直後に回す」と書いており、後者だと成立しない。

### 影響範囲

- 周1 で SKIP を外したあとの検証手順。**`make e2e` -> `make e2e-screenshots-check` の順で回す**必要がある

### 対処方針

- [ ] 周1 の検証では `make e2e` を先に回して `e2e/.screenshots-out` を更新してから check する
- [ ] 手順が誤解を招くなら CLAUDE.md か `/e2e` の記述を直す（周1 の文書ステップで判断）

### 優先度

P3

### ステータス

未対処（回避手順は判明）

---
