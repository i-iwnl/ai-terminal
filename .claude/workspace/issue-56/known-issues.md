# Known Issues

実装中に発見された未解決のバグ・先送りした課題。
詳細な観察記録は `worklog.md` を参照。

---

## 1. 分割とは独立に存在する負債（design-review で発見。**分割の周に混ぜない**）

5ペルソナのレビューが分割の実装とは無関係に見つけたもの。10件ある。
根拠と行番号は `design-review.md` の「6. この案が積み残す、分割とは独立の負債」が唯一の正。

### 症状

| # | Issue | 内容 | 体感頻度 |
|---|---|---|---|
| 1-1 | [#61](https://github.com/i-iwnl/ai-terminal/issues/61) | `TERM_PROGRAM` が素通しされ、新しいシェルタブのたびに `Restored session: ...` という**嘘の行**が出る（`manager.ts:109-118`）。`docs/images/S01-launch.png` の1行目がそれ | 10〜30回/日 |
| 1-2 | [#60](https://github.com/i-iwnl/ai-terminal/issues/60) | **tmux の `-A` が既存セッションに当たる経路がコード上1本も存在しない**（`manager.ts:170` の名前が毎回 fresh な `randomUUID`）。**claude は生き続け、アプリからは二度と戻れない** | 毎日積む |
| 1-3 / 1-4 | [#62](https://github.com/i-iwnl/ai-terminal/issues/62) | `Cmd+Shift+G`（macOS の「前を検索」）が gemini 起動に取られている / `Cmd+G` が無い | 20〜40回/日 |
| 1-5 | [#65](https://github.com/i-iwnl/ai-terminal/issues/65) | `Cmd+1`〜`9` しかなく、**10枚目以降のタブにキーボードで到達できない** | - |
| 1-6 | [#64](https://github.com/i-iwnl/ai-terminal/issues/64) | `TaskList.tsx:85-95` の `<li onClick>` に `tabindex` も `role` も無い（**キーボードで押せない**） | - |
| 1-7 | [#66](https://github.com/i-iwnl/ai-terminal/issues/66) | `wrappedInTmux` が `useTabs.ts:80-88` で捨てられ、「このタブは tmux の中」がどこにも出ない | - |
| 1-8 | [#67](https://github.com/i-iwnl/ai-terminal/issues/67) | `.terminal-search` が細いペインからはみ出す（実測 260px 前後） | 分割後に顕在化 |
| 1-9 | [#68](https://github.com/i-iwnl/ai-terminal/issues/68) | `e2e/screenshots.spec.ts:12` のコメントが「11シナリオ」（実際は12）。台帳ハーネスは検出しない | - |
| 1-10 | [#63](https://github.com/i-iwnl/ai-terminal/issues/63) | `App.tsx:106-116` のグローバル keydown が `e.target` を見ずに先取りするので、**タブ名の編集中に `Cmd+D` を押すと分割が走る** | 分割後に顕在化 |

### 影響範囲

1-2 は「走行中の claude を失う」ので実害が最も大きい。1-3 は誤爆でエージェントが1本増える。
1-8 と 1-10 は分割で初めて顕在化するので、**分割の実装中に踏む**。

### 対処方針

- [x] GitHub Issue に起票した（#60〜#68 の9本。1-3 と 1-4 は同じ領域の同じ作業なので #62 に統合した）
- [x] **1-2（#60）は解決済み**（PR #73）。resume でも tmux セッション名が安定するようになり、`Cmd+W` した claude に履歴からの resume で戻れる。**分割で `Cmd+W` の頻度が上がる前提の懸念が1つ減った**
- [ ] 1-8（#67）と 1-10（#63）は分割の周で踏むので、踏んだ時点で該当 PR に含めてよい

### 優先度

P2（1-2 = #60 のみ P1）

### ステータス

対処済み（起票完了。実装は各 Issue 側で追跡する）

---

## 2. 分割で「1タブ = 1エージェント」の前提が崩れる箇所が、まだ未定義

### 症状

design-review で洗い出したが、v2 でも決めきれていないもの。

- **タブの `title`**（`useTabs.ts:14`）: `zsh` タブの中に claude が居うる。`renameTab`（`:146-150`）との関係も未定義
- **タブバーの x ボタン**（`TabBar.tsx:120-131`）: `aria-label` が「タブを閉じる」のまま。分割中は予告なく複数の PTY を殺す
- **`Cmd+1`〜`9`**: タブ切替のままでよいか（ペインには振らない）

### 対処方針

- [ ] ペインヘッダ（提案 G）を入れる周で、タブ名の意味を「そのタブの代表」と決め切る
- [ ] x ボタンには提案 E' と同じ確認を通す

### 優先度

P2

### ステータス

調査中

---

## 3. 提案 F' の cwd は、分割の主用途で実際に外れる

### 症状

引き継ぐのは**タブ生成時の cwd** であって実 cwd ではない。
`claude` を `/repo/packages/app` で動かしていて分割すると、新しいシェルは `/repo` に出る。

### 原因

シェルの実カレントディレクトリを追跡していない（OSC 7 未対応）。

### 影響範囲

分割の主用途がまさに「エージェントの隣で `git` を打つ」なので、**静かに間違ったディレクトリでコマンドを打たせる**。

### 対処方針

- [ ] ペインヘッダに cwd の basename を出して**気づけるようにする**（提案 G に含む）
- [ ] OSC 7 による実 cwd 追跡は**非目標**。必要になったら別 Issue

### 優先度

P3

### ステータス

先送り（緩和策のみ実施）

---
