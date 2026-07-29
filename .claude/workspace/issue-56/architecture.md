# Architecture

Issue #56 における変更対象の構造。
設計判断の根拠は末尾の「設計判断履歴」を参照。

---

## 1. 対象トラック

単一トラック（renderer 中心。main はメニュー項目の追加のみ）。

| コンポーネント | 変更内容 | 影響範囲 |
|---|---|---|
| `src/renderer/src/tabs/paneTree.ts` | 追加（純粋関数。二分木の分割 / 閉じる / 隣接探索） | unit test から直接呼ぶ |
| `src/renderer/src/tabs/useTabs.ts` | 変更（`TabState` にレイアウトツリーと activePaneId を持たせる） | `App.tsx` / `TabBar.tsx` / サイドバーのタブ突き合わせ |
| `src/renderer/src/terminal/PaneLayout.tsx` | 追加（ツリーを再帰的に描画し、スプリッタを挟む） | `App.tsx` |
| `src/renderer/src/terminal/TerminalPane.tsx` | 変更（アクティブ枠・クリックでフォーカス） | - |
| `src/renderer/src/lib/shortcuts.ts` | 変更（Cmd+D / Cmd+Shift+D / Cmd+Option+矢印） | `useTerminal.ts` の `attachCustomKeyEventHandler` にも同時に効く |
| `src/main/menu.ts` | 変更（分割の項目を追加） | - |
| `src/shared/ipc.ts` | 変更（`AppAction` に分割系を追加） | menu / shortcuts の両方 |
| `src/renderer/src/styles.css` | 変更（分割レイアウト・スプリッタ・アクティブ枠） | **`/design-review` 対象** |

---

## 2. Contract（src/shared/ipc.ts）変更

| チャンネル / 型 | 変更 | 内容 |
|---|---|---|
| `AppAction` | ADD | `{ type: 'split-pane'; dir: 'row' \| 'column' }` |
| `AppAction` | ADD | `{ type: 'focus-pane'; dir: 'next' \| 'prev' \| 'left' \| 'right' \| 'up' \| 'down' }` |
| `AppAction` | ADD | `{ type: 'close-pane' }`（**`close-tab` の意味は変えない**） |
| `AppAction` | ADD | `{ type: 'toggle-pane-zoom' }` |

**`close-tab` の意味 ALTER は取りやめた。** 型が変わらない意味変更は typecheck も grep も助けてくれず、
機械が守れない。`close-pane` を新設し、`close-tab` は意味を保ったまま残す。

**`PaneNode` 型は `src/shared/` に置かない。** Main はペインの木を知る必要がなく
（PTY の spawn / kill は既存 API のまま）、置くと鉄則3の対象範囲が Renderer のレイアウト都合で膨らむ。

`IpcInvoke` / `IpcSend` / `IpcEvent` に追加は無い（PTY の spawn / kill は既存のまま使える）。

---

## 3. 技術的制約・前提条件

- **非表示タブは `visibility: hidden` で隠す方針を崩さない。** `display: none` にすると
  `ResizeObserver` と `fitAddon.fit()` が壊れる（`styles.css` にコメント済み）。
  分割で `position: absolute` の重ね置きをやめるときも、この制約は残る。
  **ただしこれは副作用の半分でしかない**（下記）。
- **`visibility: hidden` はアクセシビリティツリーからも部分木を除去している。**
  xterm は `screenReaderMode` 有効時に `aria-live="assertive"` の live region を作るので、
  今は「露出している live region は常に1個」という不変条件が**偶然**成立している。
  分割は同一タブ内の全ペインを visible にするため、この遮断が無効化される。
  assertive は読み上げを割り込んで中断するので、**2ペイン並走で VoiceOver が文を最後まで喋れなくなり、
  ユーザー自身のタイピングのエコーまで潰れる**。`screenReaderMode` はアクティブペイン限定にする。
- **`ResizeObserver` は「fit を自分で呼ばない」だけでは止まらない。**
  `useTerminal.ts:174` は `.terminal-pane__container` を observe しているので、
  CSS Grid の比率を動かした時点で全ペイン分が勝手に発火する。
  スプリッタは**ドラッグ中 Grid を動かさず、絶対配置のゴースト線だけを動かして `mouseup` で確定する**。
  この方式なら `useTerminal.ts` を1行も触らずに済む。
- **アクティブペインの線を `border` で描かない。** コンテナの実寸が変わり、
  フォーカス移動のたびに `ResizeObserver -> fit() -> pty.resize()` が走る（実行中の claude / vim が再描画される）。
  `box-shadow: inset` か `::after` の絶対配置に限定する。
- ショートカットは `lib/shortcuts.ts` が唯一の拾い口。メニュー（`src/main/menu.ts`）は
  `registerAccelerator: false` で表示のみ。**両方で登録すると二重発火する。**
- Cmd+D は zsh の EOF（Ctrl+D）とは別キーなので端末入力と衝突しない。

---

## 4. 設計判断履歴

| 日付 | 判断 | 根拠 | 代替案 |
|---|---|---|---|
| 2026-07-29 | 二分木モデルを採る（均等分割ではなく） | ユーザーが明示的に選択。均等分割から二分木への移行はモデルの作り直しになり、E2E とスクリーンショットも巻き添えになる | 最大4ペインの均等分割 / 左右2分割のみ |
| 2026-07-29 | Issue #55（D&D）を先に完了させる | 両方が `TerminalPane.tsx` を触る。分割のモデル変更を先に入れると D&D の差分が読めなくなる | 並行して進める |
| 2026-07-29 | PTY のメタ（`ptyId` / `kind` / `title` / `agentSessionId` / `cwd` / `exit`）を leaf に持たせる | `TabState` に残したままだと `markExited` / 終了バッジ / タスク一覧の突き合わせが全部 PTY 1本前提のまま壊れる（4人が指摘） | `TabState` に `layout` と `activePaneId` を足すだけ（初版） |
| 2026-07-29 | スプリッタはドラッグ中 Grid を動かさず、ゴースト線で確定する | 「fit を呼ばない」では `ResizeObserver` が止まらない。ゴースト方式なら `useTerminal.ts` を1行も触らずに済む | `doFit()` の先頭で見るモジュールスコープのドラッグ中フラグ |
| 2026-07-29 | `Cmd+Shift+W`（タブを閉じる）を新設せず、キー無しのメニュー項目にする | macOS 全域で `Cmd+Shift+W` は「ウィンドウを閉じる」。衝突はしないが、そう学習している指が N 本のエージェントを確認なしで殺す。被害が非対称 | `Cmd+Shift+W` を新設（初版・macOS ペルソナも支持） |
| 2026-07-29 | 分割の可否と `ratio` のクランプを、比率ではなく**実セル幅 x 20桁**で判定する | 比率クランプは fontSize を追跡しないので、文字を大きくしたユーザーだけが壊れる（26px + 左右分割で29桁）。閾値を桁数で持つと、13px では拒否に当たらず 26px では当たる | `ratio` を 0.1〜0.9 でクランプ（初版） |
| 2026-07-29 | スプリッタは `--border-control`。ただし `prefers-contrast: more` でアクティブ線を `--focus-ring` に切り替える | `--border-subtle` は対 `--surface-1` で 1.13 で不可視。だが `--border-control` にすると `--accent` との比が 1.56 になる。**両方 3:1 を満たすグレーは 256段に1つも存在しない**ので、解はアクティブ線側にある | `--border-control` に変えるだけ（4人の対案のまま） |
