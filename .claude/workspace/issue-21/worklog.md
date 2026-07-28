# Worklog

時系列の作業ログ。**設計判断の根拠**と**学んだ教訓**を中心に記録する。
コード差分は git log を参照、現状の構造は `architecture.md` を参照。

---

## 2026-07-29 - ワークスペース作成と計画

### 実施内容

- ブランチ `fix/task-status-color-and-wording` を作成した
- Issue #21（親: #20）の内容を確認し、ワークスペース4ファイルを作成した
- 実装前の事実確認を行った（推測で書かない）:
  - `src/main/agents/poller.ts:157` が `prev.status === 'busy' && task.status !== 'busy'` を「作業完了」として通知している -> **`busy` = エージェント稼働中で確定**
  - `src/renderer/src/styles.css:355-364` は `busy` に橙＋グロー、`idle` に緑を当てている -> **逆**
  - `src/renderer/src/sidebar/TaskList.tsx:81` は `task.status === 'busy'` の二値分岐
  - 同 `:103` が `{task.status ?? '不明'}` で CLI の生の英語を描画している
  - `README.md:106` と `e2e/screenshots.spec.ts:568,573` のキャプションも逆
  - `e2e/fixtures/harness.ts:267,276` のフィクスチャは `busy` / `idle` の2値のみ

### 設計判断

- **クラス名を意味の語に変える**: `--busy` / `--idle` -> `--working` / `--your-turn` / `--unknown`。第3の状態を足す以上クラスは増えるうえ、CLI の語をクラス名にしていると CLI の語彙変更が CSS まで波及する
- **未知の status を第3の状態にする**: `busy` 以外を機械的に「あなたの番」に寄せない（鉄則5）
- **行の再設計はしない**: 語を先頭に出す・グループ見出し・ソート・「待たせている時間」は #20 の後続 PR。この周は意味の是正だけに絞る
- **ペルソナレビューは回さない**: この周自体が #20 のレビューの出力であり、設計は確定済み。詳細は `architecture.md` の設計判断履歴

### 教訓（該当する場合）

- **誤りは1箇所では終わらない。** 今回の取り違えはコード（CSS・TSX・コメント）だけでなく、README の説明文、E2E のキャプション、そこから生成された掲載画像まで4段階に伝播していた。**生成物を持つドキュメントは、元の文言を直しただけでは直らない**（画像の中身は機械では検査されない）
- `make e2e-lint` は `e2e/screenshots.spec.ts` を検査対象にしていない。今回のキャプション誤りが機械で検出されなかった原因はここ

### 次に再開するとき最初に読むべきこと

- **未着手**: 実装（`TaskList.tsx` の3値化 -> `styles.css` の逆転 -> README / キャプション / S12 spec -> スクリーンショット撮り直し）
- 判断は `architecture.md` の設計判断履歴で確定済み。**再検討せずそのまま進めてよい**
- 実装後に `make check` -> `make e2e` -> `make e2e-lint` の順で通す
- **S12 の spec を書き換えるときは、書き換えたテストが「色を戻したら赤くなる」ことまで確認する**（通ることの確認だけでは検証していないのと同じ。`issue-1/worklog.md` に前例あり）

---

## 2026-07-29 - 実装・検証・撮り直し

### 実施内容

- `TaskList.tsx` に `toTaskState()` と `TASK_STATE_LABEL` を追加し、状態を3値化した。クラス名を `--working` / `--your-turn` / `--unknown` に変更
- `.task-item__meta` に翻訳ラベル（`.task-item__state`）と生の値（`.task-item__raw-status`）を並べた
- `styles.css` の強調を逆転させた（グローを持つのは `--your-turn` の側）
- `README.md:106` / `e2e/screenshots.spec.ts` のキャプションを実装に合わせた
- `S12-task-list.spec.ts` を書き直し、`docs/images/S12-task-list.png` を撮り直した
- 検証: `make check`（unit 63）/ `make e2e`（35 passed）/ `make e2e-lint`（PASS=258 FAIL=0）

### 設計判断

- **S12 の主眼を「2件が区別されること」から「強調されているのがあなたの番の側であること」に変えた**。色が違うことだけを見ていると、今回のような**意味の反転を検出できない**。`box-shadow` を持つのが `--your-turn` だけであることを assert している
- メタ行に `flex-wrap: wrap` + 子要素の `white-space: nowrap` を入れた。項目が4つになり幅 260px では折り返しが避けられないが、**折り返す単位は項目であって語ではない**（「あなたの / 番」と割れていた）

### 教訓（該当する場合）

- **`npx playwright test` を直接叩くと、直前のソース変更が反映されない。** E2E はビルド済みの `out/` を起動する（`playwright.config.ts` の冒頭に明記されている）。最初の「赤くなることの確認」で**テストが通ってしまい、検証できたと誤認しかけた**。`make e2e` はターゲットが `build` に依存しているのでこの罠を踏まない。**再現確認では必ず `make build` を挟む**
- **スクリーンショットの注釈は、番号と配置を「意味の重要度」ではなく「行の並び順」に合わせる。** 意味を優先して番号を入れ替えたら、吹き出しが下の行に重なって**説明したい行そのものを隠した**。撮った画像を必ず目で見る
- `make e2e` の S12 が1回 flaky になった（Electron の起動でウィンドウが出ない）。既知の [#17](https://github.com/i-iwnl/ai-terminal/issues/17) で、リトライで green。テスト設計の問題ではない

### 次に再開するとき最初に読むべきこと

- **Issue #21 の実装・検証・文書更新は完了。** 残りは commit / push / PR 作成（ユーザーの明示指示があるときのみ）
- `known-issues.md` の1番（UI と poller の判断が食い違う）は**未対処**。[#24](https://github.com/i-iwnl/ai-terminal/issues/24)（Dock バッジ）に着手する前に、既知 status の定義を `src/shared/` に共通化するかを決める必要がある。**#24 で3箇所目の判定が生まれる**
- 次に着手するのは #22 / #23 / #24 のいずれか（互いに独立）。#25 は #20 の D（設定ウィンドウ化）と重なるので、方針を決めてから

---

<!-- 以降、作業のたびにセクションを追記 -->
