# Architecture

Issue #131 における変更対象の構造。

---

## 1. 対象トラック

単一トラック（renderer のみ）。**`src/main/` は1行も変えない。**

| コンポーネント | 変更内容 | 影響範囲 |
|---|---|---|
| `src/renderer/src/tabs/tabPane.ts` | 変更（`TabState.title` 追加、`tabRepresentativeLeaf` / `tabDisplayTitle` 新設） | `TabBar.tsx` / `App.tsx` |
| `src/renderer/src/tabs/useTabs.ts` | 変更（`renameTab(tabId, title)` を新設。`renamePane` は残す） | `App.tsx` |
| `src/renderer/src/tabs/TabBar.tsx` | 変更（見出し・色・ツールチップの出所、ダブルクリックの宛先、入力欄の aria-label） | - |
| `src/renderer/src/App.tsx` | 変更（ウィンドウタイトルの出所、`onRename` の配線） | - |
| `src/renderer/src/styles.css` | **変更しない** | - |

---

## 2. Contract（src/shared/ipc.ts）変更

**なし。** `TabState` は Renderer 内の型で、IPC の語彙ではない
（`PaneNode` を `src/shared/` に置かないのと同じ理由。Issue #56 の判断）。

---

## 3. 技術的制約・前提条件

- **導出は1本に集約する。** `tabDisplayTitle(tab) = tab.title ?? flattenPaneTree(tab.layout)[0].title`。
  タブバー・ウィンドウタイトル・プロバイダ色・ツールチップが全部これを通る。
  **借り先が箇所ごとにずれる状態を作らない**（今の不具合がまさにそれ）
- **「識別」と「状態」を分ける。** 見出しとプロバイダ色は**識別**なので代表 leaf から引く。
  終了バッジ・`is-exited`・「あなたの番」は**状態**で、それぞれ別の意味が既に決まっている
  （your-turn は木の全 leaf / exit は `issue-56/design-review.md:81` が `every` を確定済みだが
  実装はアクティブ leaf のまま）。**この Issue では状態側に触らない**
- **`.pane-header` と `styles.css` を触らない。** `docs/images/` の撮り直しを発生させない
- **空文字の扱いが `renamePane` と非対称になる。** `renamePane` は trim 後の空文字を無視するが、
  `renameTab` は `undefined` に戻して導出へ落とす（「名前を消して既定に戻す」経路）。
  非対称であることをコメントに残す

---

## 4. 設計判断履歴

| 日付 | 判断 | 根拠 | 代替案 |
|---|---|---|---|
| 2026-08-04 | (d) タブに名前を持たせる | (a) は `Cmd+]` のたびに4つが動く（40〜80回/日）。(b) は先頭ペインを閉じたときに名前がジャンプし、**タブの名前が最初に開いたペインの寿命に縛られる** | (a) 現状維持 / (b) 先頭 leaf に固定 / (c) `title ほか N` |
| 2026-08-04 | 「新しい状態を増やさない」という却下理由は採らない | Issue #130 で `PaneLeaf.renamed` を1つ増やしている。**状態を増やすかどうかではなく、増やした状態が何を表すかで判断する** | #130 のレビューで3人が (d) を却下した理由をそのまま踏襲する |
| 2026-08-04 | タブのダブルクリックの宛先を**ペインからタブへ**変える | いまタブを押しているのにペインが書き換わる（#130 で判明した食い違い）。**押した対象と変わるものを一致させる**。レビューが (d) に対して挙げた唯一の実質的な反論（2つの命名 UI）は、入り口の対象を分けることで解ける | ダブルクリックをペイン宛のまま残す |
| 2026-08-04 | プロバイダ色とツールチップも代表 leaf へ移す | 見出しだけ安定させても、`Cmd+]` でタブ上端の色が往復するならちらつきは消えない | 見出しだけを移す |
| 2026-08-04 | 終了バッジ・`is-exited`・「あなたの番」には触らない | 「識別」と「状態」は別軸。exit の意味は `issue-56/design-review.md:81` が `every` を確定済みで、**この Issue で第三の意味を持ち込まない** | 代表 leaf から exit も引く |
