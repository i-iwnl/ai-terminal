# Architecture

Issue #130 における変更対象の構造。
設計判断の根拠は末尾の「設計判断履歴」を参照。

---

## 1. 対象トラック

単一トラック（renderer 中心。main は `menu.ts` の1項目追加のみ）。

| コンポーネント | 変更内容 | 影響範囲 |
|---|---|---|
| `src/renderer/src/tabs/paneHeader.ts` | 変更（`paneHeaderLabel` に分岐、`paneAriaLabel` を新設） | `PaneTreeView.tsx` / `App.tsx:353`（通知バナー） |
| `src/renderer/src/tabs/PaneTreeView.tsx` | 変更（`label` に加えて `ariaLabel` / `titleAttr` を渡す） | `TerminalPane.tsx` |
| `src/renderer/src/terminal/TerminalPane.tsx` | 変更（`title` 属性の追加、`aria-label` の出所を分ける） | - |
| `src/shared/ipc.ts` | 変更（`AppAction` に `rename-active-pane` を追加） | `menu.ts` / `App.tsx` |
| `src/main/menu.ts` | 変更（「表示」に `ペイン名を変更...`） | - |
| `src/renderer/src/App.tsx` | 変更（`rename-active-pane` の受け口） | `TabBar.tsx`（既存のリネーム入力欄を開く） |
| `src/renderer/src/tabs/TabBar.tsx` | 変更（外部からリネーム編集を開始できるようにする） | - |
| **`src/renderer/src/styles.css`** | **変更しない**（この Issue の設計上の制約） | - |

---

## 2. Contract（src/shared/ipc.ts）変更

| チャンネル / 型 | 変更 | 内容 |
|---|---|---|
| `AppAction` | ADD | `{ type: 'rename-active-pane' }` |

`IpcInvoke` / `IpcSend` / `IpcEvent` に**追加は無い**。`AppAction` は既存のチャンネルで
Main -> Renderer へ流れる union なので、preload / contextBridge は1行も変わらない。

**`PaneLeaf` / `PaneNode` は `src/shared/` に置かない**（Issue #56 の判断を維持する。
Main はペインの木を知る必要がない）。

---

## 3. 技術的制約・前提条件

- **CSS を1行も触らない。** `.pane-header` の高さ 18px は据え置く。触ると `docs/images/S56-split-pane.png`
  の撮り直しが発生し、`.pane-header ~ .terminal-search { top: calc(var(--sp-2) + 18px) }`
  （`styles.css:1055`）との二重管理にも手を入れることになる。**この Issue のスコープ外**
- **`.pane-header` の `aria-hidden="true"` を維持する。** ヘッダをインタラクティブにしないので
  外す理由が無く、`role="group"` の `aria-label` との二重読み上げを避ける
- **live region を1つも増やさない。** `S37` / `S48` が「露出している live region は1個」を
  不変条件として固定している
- **`aria-label` は可視テキストを先頭に置く**（WCAG 2.5.3 Label in Name）。
  組み立ては `TabBar.tsx:329-339` の `tabAccessibleLabel` と同じ形にする。
  **この repo は同じ問題に対して既にこの結論を出している**
- **`paneHeaderLabel` の消費者は3つ。** `PaneTreeView.tsx:101`（ヘッダ表示 + aria-label）と
  `App.tsx:353`（通知バナー / `role="status"` の文言。`S63:109,112` が assert 済み）。
  分岐を入れるときは**通知バナー側で何が出るか**を必ず確認する
- **ヘッダの幅は分割の下限で 148.6px しかない**（`MIN_PANE_COLUMNS = 20` -> ペイン幅 164.6px、
  `padding: 0 var(--sp-2)` x2 を引いた残り）。**単一スロットを維持する**
- ショートカットは `lib/shortcuts.ts` が唯一の拾い口。メニューは `registerAccelerator: false` で
  表示のみ。**両方で登録すると二重発火する**（ただし今回はアクセラレータを割り当てない）

---

## 4. 設計判断履歴

| 日付 | 判断 | 根拠 | 代替案 |
|---|---|---|---|
| 2026-08-04 | ヘッダは**単一スロットのまま分岐**する（名前があれば名前、無ければ `種別・cwd`） | 2要素は分割の下限幅 148.6px に対し必要 208.7px（再開版 242.4px）で 60〜94px 不足。かつ `styles.css:76-79` が「secondary/tertiary は 1.28 で段として見えないので同じ行に隣接させない」と明文で禁止（実測 1.276）。`styles.css:243` により `prefers-contrast: more` では完全に同色 | 主 `title` + 従 `種別・cwd` の2要素（初版）/ ウェイトで階層を作る（macOS ペルソナ案） |
| 2026-08-04 | リネームの導線は**メニュー項目**にする（ヘッダには置かない） | 5人が別々の理由で否定。`TerminalPane.tsx:167-171` の focus 効果で非アクティブペインでは開いた瞬間に閉じる / 入力欄 約20px が 18px に入らない / WCAG 2.5.8 の 24x24 を割り広げた先が xterm の1行目 / Tab は xterm が食うので到達不能 / `S44` は手書き列挙なので黙って入る | ヘッダのダブルクリック（初版） |
| 2026-08-04 | `onTitleChange`（OSC 0/2）による自動命名は**採らない** | **実測で塞がっている。** エージェントペインは tmux ラップだが `set-titles` は既定 off（`tmux -f /dev/null` で確認）。分割で作るシェルペインは tmux 対象外だが `~/.zshrc` に title を設定する `precmd` が無い。現状では一度も発火しない | `xterm.js` の `onTitleChange` を購読して自動命名（ヘビーユーザー案） |
| 2026-08-04 | ヘッダに**視覚の終了バッジを出さない**。`aria-label` にだけ入れる | `useTerminal.ts:208-211` が終了したペインのスクロールバックに `[プロセスは終了しました（コード N）]` を書いており、出力はそこで止まるのでその行は常に画面最下部にある = **視覚には重複**。一方 WebGL レンダラは canvas に描くため、`screenReaderMode` が false のペイン（分割中の非アクティブペイン全部）は**支援技術から見て中身が空**で、ヘッダの文字列が唯一の情報源 | ヘッダに「終了」バッジを出す（初版）/ 何も出さない |
| 2026-08-04 | タブバーの終了判定（`some` / `every`）は**この Issue では触らない** | `issue-56/design-review.md:81` が `every` を確定済みで、`TabBar.tsx:351-353` の「終了を優先する」により `some` にすると**「あなたの番」のドットが消える**。確定済み設計の変更なので、別 Issue で扱う | `flattenPaneTree().some(l => l.exit)` に変える（初版の提案 C 後半） |
| 2026-08-04 | タブバーの見出し・ウィンドウタイトルの**代表ペイン固定はこの Issue では扱わない** | ユーザーの要求（「そのペインで何を作業していたか忘れる」）に対する最短経路はヘッダ表示で、タブバーの分離は独立した価値。混ぜると PR が大きくなり、`docs/images/` にも波及する | タブバー・プロバイダ色・ツールチップ・ウィンドウタイトルを先頭 leaf に揃える（v2 の PR 4） |
| 2026-08-04 | **CSS を1行も触らない**を制約として明示する | 触ると `docs/images/S56-split-pane.png` の撮り直しと `styles.css:1055` の 18px 二重管理に波及する。トークン化は「置換だけの周」として分離するのが CLAUDE.md の規約 | 18px を `--pane-header-height` にトークン化してから進める（保守ペルソナ案。**別 Issue に切り出す**） |
