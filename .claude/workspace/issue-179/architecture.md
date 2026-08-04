# Architecture

Issue #179 における変更対象の構造。
設計判断の根拠は末尾の「設計判断履歴」を参照。

---

## 1. 対象トラック

**単一トラック**（renderer の CSS / React と、E2E ハーネス・検査スクリプト）。
Main プロセスには触れない見込み（周4 の `WebglAddon` も renderer 側）。

| コンポーネント | 変更内容 | 影響範囲 |
|---|---|---|
| `e2e/specs/S40-contrast-contract.spec.ts` | 計測対象の追加（周1）・期待値の更新（周2） | 期待値表は characterization。値が動けば必ず diff に出る |
| `e2e/specs/S41-prefers-contrast.spec.ts` | 高コントラスト側の計測対象の追加（周1）・しきい値の追加（周2） | `emulateMedia({ contrast: 'more' })` を使う唯一の spec |
| `e2e/screenshots.spec.ts` | S56 の撮影前に「2枚目のペインの先頭行がプロンプトそのもの」まで待つ（周1） | 撮影レーンのみ。`docs/images/` の画像は1枚も変わらない |
| `scripts/verify-screenshots.mjs` | `KNOWN_NONDETERMINISTIC` から `S56-split-pane.png` を外す（周1） | check3 の対象が 12 -> 13 枚になる |
| `docs/images/S56-split-pane.png` | 撮り直し（周1） | README 掲載画像 |
| `src/renderer/src/styles.css` | `@media (prefers-contrast: more)` の追加（周2）・`.is-active.is-exited` の結合状態規則（周2）・終了表示の severity 分割（周3） | S40 / S41 / S78 / 撮影レーン |
| `src/renderer/src/tabs/TabBar.tsx` | 終了表示の語と severity（周3） | S40 の `exitedActive` バッチ・S78 |
| `src/renderer/src/terminal/` | `WebglAddon.onContextLoss`（周4）・`Cmd+F` の選択引き継ぎ（周6） | S23 / 検索まわりの spec |

---

## 2. Contract（src/shared/ipc.ts）変更

**なし。** 6周のいずれも IPC のチャンネル名・型に触れない見込み。
触ることになったらこの節を更新し、`/electron-ipc` を通す。

---

## 3. 技術的制約・前提条件

- **PTY の出力は加工しない**（ルート CLAUDE.md の鉄則2）。周1 の S56 非決定性は、出力を後から整形するのではなく **zsh 側の設定（`PROMPT_EOL_MARK`）で出さないようにする**ことで潰す
- **本体に色のリテラルを直接書かない**（`:root` のトークンが唯一の正。単体テストが検出する）
- **値の変更とトークン化を混ぜない**。周1 は関門だけを作り、製品側の値を1つも変えない
- `contrast.ts` の `measureContrast` は**単一プロパティを色として解決する**実装なので `box-shadow` の形は測れない（形の検証は S78 が `getComputedStyle` の文字列で行っている）

---

## 4. 設計判断履歴

| 日付 | 判断 | 根拠 | 代替案 |
|---|---|---|---|
| 2026-08-04 | **#165 の「`contrast.ts` に `against` を明示できる口を足す」は不要**。`ContrastTarget` には既に `against?: string`（要素セレクタ）と `againstColor?: string`（CSS 変数名）の**2つが実装済み**で、どちらも指定すれば border -> 親解決の分岐を迂回する | 実コードを読んで確認（`e2e/fixtures/contrast.ts` の `measureContrast`）。Issue 本文の現状認識が古い。loop.md の計画ゲートが要求する「実コードで測り直す」に該当 | ハーネスに新 API を足す（不要な重複になる） |
| 2026-08-04 | プロバイダ色は `againstColor: '--surface-tab-active'` で測る（タブを実際にアクティブにして `against` で引かない） | プロバイダ色は3種類（shell / claude / gemini）あり、アクティブなタブは同時に1つしか作れない。トークン値と比べれば1回のセットアップで3本とも測れる。`@media` はトークンを差し替えるので、高コントラスト側も同じ書き方で追従する | 3タブを順にアクティブにして `against: '.tab-bar__tab.is-active'` で測る（セットアップが3倍・得られる値は同じ） |
| 2026-08-04 | ~~S56 の非決定性は `.zshrc` に `PROMPT_EOL_MARK=''` を書いて潰す~~ **却下（実測で反証）** | 立案時の根拠は `verify-screenshots.mjs` の SKIP 理由（zsh の部分行マーカー）だったが、**8回ずつ撮って比べたら効かなかった**（現状のまま 8枚が2種類 / `PROMPT_EOL_MARK=''` を足しても 8枚が2種類）。マーカーを消しても部分行が消費する1行は残る | 下の行の採用案 |
| 2026-08-04 | **S56 の非決定性は「撮影前の待ち合わせを強くする」ことで潰す**。2枚目のペインの先頭行が**プロンプトそのものになる**まで待つ | 8回撮って**8枚とも画素一致**（2026-08-04 実測）。しかも**その画像はコミット済みの1枚と1画素も違わない** = 正体は「シェルの出力が非決定」ではなく**素朴な競合**（既存の `toContainText(/[$%#>]/)` は画面のどこかにプロンプト文字があれば通るので、先頭行に落ち着く前に撮れていた）。シェルの設定も撮影内容も画像も変えずに済む | `clear` を打って画面を正規化する（**コマンド名が画面にエコーされ `demo-project % clear` が README の画像に残った**ので却下）／Ctrl+L を送る（8/8 一致するが、待ち合わせだけで足りるので不要な入力になる）／ヘッダを含む決定的な別カットを1枚足す |
| 2026-08-04 | S56 の待ち合わせは `toContainText(cwdName)` ではなく**先頭行の完全一致**にする | `toContainText` は弱すぎて、`clear` がエコーされた `demo-project % clear` の状態でも素通りし、実際にその画面を撮ってしまった。完全一致なら「先頭行がまだ空」「余分な語が乗っている」の両方で待ち続ける | 部分一致（上記のとおり実際に素通りした） |
| 2026-08-04 | 周ごとに `main` から独立したブランチを生やす | ルート CLAUDE.md「スタック PR を作らない」。base をマージすると子 PR が自動クローズされ再オープンできない実例あり | 1本のブランチに6周ぶんを積む（レビュー不能・順序制約の検証ができない） |
