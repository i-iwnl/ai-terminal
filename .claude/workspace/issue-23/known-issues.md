# Known Issues

実装中に発見された未解決のバグ・先送りした課題。
詳細な観察記録は `worklog.md` を参照。

---

## 棚卸し（2026-08-04）

**実コードで1件ずつ現状を測り直した結果**（main = 61edbe5 時点）。
`.claude/skills/workspace-plan/operations/promote-known-issues.md` の手順による。
**元の記述は観察の記録として残す。** 状態の唯一の正は GitHub Issue。

| 項目 | 判定 | 根拠 |
|---|---|---|
| 1. 実際の読み上げ品質は自動検証できない | **生きている → #148** | 構造上の限界であることは不変（S37 の冒頭コメント）。加えて**手動確認も未実施**。`.claude/workspace/` 全体を検索しても「VoiceOver で確認した」記録は無く、#119 / #120 / #121 で行われた手動確認は D-3（D&D）と vibrancy だけ。`README.md` にも TUI での実用限界の警告が無い |
| 2. 検知で有効化してもユーザーに何も見えない | **生きている → #149** | `SettingsPanelProps` は `{ config, onChange, onClose }` の3つのみで `accessibilitySupport` は渡っていない。節の説明文は #23 本体（`613f2f8`）から変わっておらず、静的な一般論 |
| 3. 読み上げラベルが英語の既定のまま | **生きている → #150** | `promptLabel` / `.strings` はリポジトリ全体で**参照0件**。`new Terminal({...})` に渡すオプションは7つでラベル系は無い。textarea に `aria-label` も付いていない |

**記述のずれ**: 2 番の「実効値を Renderer 側で計算しており」— 設定は `226b04e` で独立した BrowserWindow に移っており、値を渡すだけでは済まない（Main の送信先を増やす判断が要る）。3 番の `Terminal.strings` は**静的プロパティ**なので、インスタンス単位では設定できない。

---


## 1. 実際の読み上げ品質は自動検証できない

> **GitHub Issue**: [#148](https://github.com/i-iwnl/ai-terminal/issues/148)

### 症状

E2E `S37` が担保するのは「読み上げの対象になる DOM が存在し、出力がテキストとして入っている」ところまで。
**VoiceOver が実際にどう読むか**は確認していない。

### 原因（判明している場合）

OS の支援技術を起動する必要があり、CI でも手元の E2E でも再現できない。
加えて xterm 側には出力が速すぎるときに読み上げを打ち切る挙動があり、
AI CLI の大量・高速な出力（とくに TUI の部分再描画）でどう振る舞うかは実測しないと分からない。

### 影響範囲

- `src/renderer/src/terminal/useTerminal.ts`
- 支援技術を使うユーザーの体験そのもの

### 対処方針

- [ ] macOS の VoiceOver（Cmd+F5）を起動し、`make build` した成果物でシェル出力が読み上げられることを確認する
- [ ] `claude` を起動した状態でも試し、TUI の再描画で読み上げが実用にならないなら、その事実を README に書く（**期待させないことも設計**）

### 優先度

P2

### ステータス

未対処（`manual-only` 相当）

---

## 2. 支援技術で検知して有効化しても、ユーザーには何も見えない

> **GitHub Issue**: [#149](https://github.com/i-iwnl/ai-terminal/issues/149)

### 症状

VoiceOver が動いていると設定に関わらず `screenReaderMode` が有効になるが、
設定パネルのチェックボックスは false のままで、**「いま有効になっている」ことが画面に出ない**。

### 原因（判明している場合）

実効値（`config.screenReaderMode || accessibilitySupport`）を Renderer 側で計算しており、
その結果を UI に出していない。

### 影響範囲

- `src/renderer/src/settings/SettingsPanel.tsx`
- 「なぜか描画が重い」と感じたユーザーが原因に辿り着けない

### 対処方針

- [ ] 検知で有効になっているときは、チェックボックスの近くに「VoiceOver を検知したため有効です」と出す
- [ ] #20 の I-6（設定同士の隠れた依存を明示する）と同じ論点なので、まとめて対処してもよい

### 優先度

P3

### ステータス

未対処

---

## 3. ターミナルの読み上げラベルが英語の既定のまま

> **GitHub Issue**: [#150](https://github.com/i-iwnl/ai-terminal/issues/150)

### 症状

xterm の入力用 textarea には既定の英語ラベルが付いており、複数タブを開くと
VoiceOver のローターに同じ名前の項目が並ぶ。どのタブの端末か区別できない。

### 原因（判明している場合）

`Terminal.strings.promptLabel` を設定していない。

### 影響範囲

- `src/renderer/src/terminal/useTerminal.ts`

### 対処方針

- [ ] 「ターミナル: <タブ名>」の形にする。タブ名は #20 の C（タブタイトルを `basename(cwd)` にする）と揃える

### 優先度

P3

### ステータス

未対処（#20 の C と一緒にやるのが安い）

---
