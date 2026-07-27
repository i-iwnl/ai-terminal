# 自動テストで担保できないもの

この E2E 基盤（Playwright + 隔離ハーネス）が届く範囲には限界がある。「自動化できていないから未検証」ではなく、代替手段とセットで扱う。

## 対象外の項目と代替手段

| 対象外 | 理由 | 代替手段 |
|---|---|---|
| macOS の実 IME（ことえり等）との相互作用 | Playwright は Chromium の DevTools Protocol（`Input.imeSetComposition`）で変換中状態を作れるが、これは xterm.js 側の composition 処理を通すだけで、OS の入力メソッドそのものは動かしていない | S22（[../../../../e2e/specs/S22-ime-composition.spec.ts](../../../../e2e/specs/S22-ime-composition.spec.ts)）が xterm.js 側の経路までを担保する。OS レベルの確認は [/terminal](../../terminal/SKILL.md) の [operations/verify-terminal.md](../../terminal/operations/verify-terminal.md) にある手動チェックリストで行う |
| vim / htop の描画品質 | 崩れているかどうかの判定は人間の目に依存し、機械的な合否基準を作れない | E2E では起動できること・アプリがクラッシュしないことのみを検証する。見た目の崩れは手動確認に委ねる |
| macOS 通知 | Playwright から OS 通知の表示を検証する手段が無い | 検証手段なし（既知の限界として扱う） |
| tmux セッションの永続化 | アプリ再起動を跨ぐ挙動であり、1回のテストプロセス内で完結する E2E の前提を超える | 範囲外。ハーネスは `useTmux: false` を固定し、tmux 経路自体を経由しないようにしている |
| `ownedByApp` が true になる肯定側のケース | 偽 CLI が返す `agents --json` の固定データは、アプリが実際に起動時に採番する UUID（`crypto.randomUUID()`）を含められない。ハーネスに「アプリが起動したタスクを偽 CLI の出力へ動的に反映する」仕組みが無いため、原理的に再現できない | 否定側（無関係な固定タスクが誤って owned 扱いにならないこと）のみを S15（[../../../../e2e/specs/S15-task-owned.spec.ts](../../../../e2e/specs/S15-task-owned.spec.ts)）で検証している。肯定側を検証するには、`agents.json` を動的に差し替えられるようハーネスを拡張する必要がある |

## CI で回していない理由

E2E は CI に組み込んでいない。Linux ランナーでは Electron の GUI 起動に xvfb が要り、macOS ランナーは実行コストが高い（`playwright.config.ts` のコメントにも明記）。現状は**ローカル実行のみ**（`make e2e`）。
