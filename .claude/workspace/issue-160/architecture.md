# Architecture

Issue #160 における変更対象の構造。
設計判断の根拠は末尾の「設計判断履歴」を参照。

---

## 1. 対象トラック

**単一トラック（renderer 主体）**。ただし #133 だけが main + shared に及ぶ。

| コンポーネント | 変更内容 | 影響範囲 | 周 |
|---|---|---|---|
| `e2e/specs/S55-notice-severity.spec.ts` | 追加（終了行の assert） | `e2e/scenarios.yml` の note | 1 |
| `test/unit/`（新規・メニュー静的検査） | 追加 | `src/main/menu.ts` をテキストとして読む | 1 |
| `e2e/specs/S40-contrast-contract.spec.ts` / `S41` | 追加（characterization → 期待値更新） | — | 1・3 |
| `src/renderer/src/tabs/TabBar.tsx` | 変更（`leaf.exit` の参照4箇所 → 木全体） | `tabPane.ts` に純粋関数を新設 | 2 |
| `src/renderer/src/styles.css` | 変更（`--status-exited` / `--pane-header-height`） | `test/unit/css-tokens.test.ts` | 3・5 |
| `src/renderer/src/tabs/paneHeader.ts` / `useTabs.ts` | 変更（`'zsh'` リテラル4箇所） | `test/unit/pane-header.test.ts` / S57 / S86 / `docs/images/S56-split-pane.png` | 4 |
| `src/renderer/src/tabs/tabYourTurn.ts` / `App.tsx` | 変更（戻り値をペイン粒度へ） | `test/unit/tab-your-turn.test.ts`（9ケース） | 6 |
| `src/renderer/src/tabs/useTabs.ts` / `closeTabCopy.ts` | 変更（`closeActivePane` にガード） | `test/unit/close-tab-copy.test.ts` | 7 |
| **`src/main/pty/manager.ts`** + **`src/shared/`** | 追加（exit 時の dock bounce と判定関数） | `src/renderer/src/lib/notices.ts` から移設 | 8 |
| `src/renderer/src/terminal/TerminalPane.tsx` ほか | 追加（コンテキストメニュー） | `e2e/scenarios.yml` に新シナリオ | 9 |

---

## 2. Contract（src/shared/ipc.ts）変更

**周4（#137）で変更する可能性がある。それ以外の周では変更しない。**

| チャンネル / 型 | 変更 | 内容 | 周 |
|---|---|---|---|
| `SpawnPtyResult` | **ALTER（候補）** | 解決済みシェル名を1フィールド追加。`kind === 'shell'` は tmux ラップ対象外なので `buildShellPlan()` の `basePlan.command` がそのまま使える。**採否は周4 の計画ゲートで決める**（選択肢2「語を揃える」を採るなら変更なし） | 4 |
| — | なし | 周9（#135）で Main の `Menu.popup()` を採る場合はチャンネルが1本要るが、**Renderer の HTML メニューを採れば不要**。周9 の計画ゲートで決める | 9 |

Contract を変更する周では [/electron-ipc](../../skills/electron-ipc/SKILL.md) を読み、この表を更新すること。

---

## 3. 技術的制約・前提条件

- **`src/shared/` の型は Main / Renderer の両方から見える。`src/renderer/` は Main から見えない。** `tsconfig.node.json` の `include` は `src/main` / `src/preload` / `src/shared` のみで `paths` も `@shared/*` だけ。**#133 が `severityForExit` を使えないのはこれが理由**
- **PTY の出力は加工しない**（ルート CLAUDE.md の鉄則2）。#136 が検証する `[プロセスは終了しました]` は PTY 出力ではなく `useTerminal.ts` がアプリ側から `term.write()` している行なので、この鉄則には抵触しない
- **CSS のデザイントークンは「置換」と「値の変更」を同じ変更に混ぜない**（ルート CLAUDE.md）。周5（#138）は置換のみ、周3（#134）は値の変更のみ
- **色のリテラルを本体に直接書かない**（`test/unit/css-tokens.test.ts` が検出する）。ただし `@media (prefers-contrast: more)` 内の `:root` は `splitRoot()` が明示的に除外している
- **E2E ハーネスの `SHELL` は `/bin/zsh` にハードで固定されている。** #137 の関門は `launchApp({ config: { shell: '/bin/bash' } })` で作る（`buildShellPlan` が `config.shell` を `$SHELL` より優先する性質を使う。**ハーネス改造は不要**）
- **`dock.bounce` は Playwright から観測できない。** #133 の関門は純粋関数の unit までで、呼び出し自体は手動確認として記録する
- **ネイティブの `Menu.popup()` は DOM に出ない。** `S36` が使う `Menu.getApplicationMenu()` に相当する getter が popup には無いので、#135 で E2E 検証を成立させたいなら Renderer の HTML メニューを選ぶ

---

## 4. 設計判断履歴

| 日付 | 判断 | 根拠 | 代替案 |
|---|---|---|---|
| 2026-08-04 | **P1 と P2 を1本の束ねにし、P3 を #161 に分けた** | #119 / #120 / #121 の前例が優先度ごとに1本。P1 は2件しかなく、うち #137 はペインヘッダ系で P2 の #138 と隣接するため、分けるより同じ束ねに置くほうが順序を管理しやすい | P1 / P2 / P3 で3本に分ける（P1 が2件では薄い） |
| 2026-08-04 | **周1 を関門づくりに専念させ、値と振る舞いを1つも変えない** | 実測で**10件すべて関門が無い**ことが分かった。混ぜると赤くなったのが新しい検査のせいか変更のせいか分離できない（loop.md の明文の規約） | 各周の中で関門と修正を同時に入れる |
| 2026-08-04 | **#142 → #140 の順に固定した**（#140 は #161 側） | どちらも `TabBar.tsx` の `leaf.exit` 参照4箇所に触る。#142 が `const leaf` を `allExited` に置き換えるので、#140 を先にやると置換対象が消えて衝突する | 同じ周でまとめる（束ねが違うので PR が跨る） |
| 2026-08-04 | **#137 と #138 を別の周にした** | #137 は文字列を変えるので `docs/images/S56-split-pane.png` が必ず変わる。#138 の完了条件は「画像差分0枚」。混ぜると画像が動いた原因を分離できない | 同じ「ペインヘッダの周」にまとめる |
| 2026-08-04 | **#135 の実装形式を周9 の計画ゲートまで未決にした** | Main の `Menu.popup()` は DOM に出ず Playwright から中身を検証できない。完了条件「E2E で検証されている」と両立するのは Renderer の HTML メニュー。ただし macOS の作法としてはネイティブが正しいので、`/design-review` の判断を仰ぐ余地がある | いま Renderer HTML に決め打つ |
| 2026-08-04 | **#133 の `severityForExit` の置き場を周8 の計画ゲートまで未決にした** | `src/shared/` へ移すのが自然だが、Renderer 専用だった関数を共有に上げるのは影響範囲の判断が要る（`test/unit/notices.test.ts` の import も動く） | Main 側に判定を複製する（同じ値に対して正が2つになる） |
