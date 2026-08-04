# Architecture

Issue #178 における変更対象の構造。
設計判断の根拠は末尾の「設計判断履歴」を参照。

---

## 1. 対象トラック

単一トラック（main が主。renderer は `useTerminal.ts` の1箇所だけ）。

| コンポーネント | 変更内容 | 影響範囲 |
|---|---|---|
| `src/main/external-links.ts`（新規） | 追加。`attachExternalLinkHandler(win)` と、スキーム判定の純粋関数 `isSafeExternalUrl(url)` | `index.ts` / `settings-window.ts` |
| `src/main/index.ts` | 変更。`createWindow()` の中で `attachExternalLinkHandler(win)` を呼ぶ | 本体ウィンドウ |
| `src/main/settings-window.ts` | 変更。同上 | 設定ウィンドウ |
| `src/renderer/src/terminal/useTerminal.ts` | 変更。`WebLinksAddon` のハンドラに修飾キーの門を入れる（周2） | ターミナル面のクリック |
| `src/renderer/src/terminal/linkActivation.ts`（新規・周2） | 追加。`shouldActivateLink(event)` の純粋関数 | 上記 |
| `test/unit/external-links.test.ts`（新規） | 追加。スキーム判定の固定 | - |
| `e2e/scenarios.yml` / `e2e/specs/S92-*.ts` / `S93-*.ts` | 追加 | 台帳 |
| `README.md` | 変更（周2）。Cmd+クリックの作法 | - |

---

## 2. Contract（src/shared/ipc.ts）変更

**なし。** リンクの逃がしは Main の `webContents` イベント内で完結し、Renderer との新しい取り決めを作らない。

---

## 3. 技術的制約・前提条件

- **鉄則1（Renderer は OS を直接触らない）**: `shell.openExternal` は Main 側でのみ呼ぶ。`window.open` は Renderer に残るが、実際にブラウザを開くのは Main の `setWindowOpenHandler`。preload に新しい API を足さずに済むのが、この形を選ぶ理由。
- **鉄則5（外から来る値は絞り込む）**: `window.open` に渡る URL は PTY 出力（= 外部）由来。`shell.openExternal` は `file://` や任意のカスタムスキームで**他アプリを起動できる**ので、`http` / `https` / `mailto` の allowlist で絞る。
- `@xterm/addon-web-links@0.12` の `constructor(handler?: (event: MouseEvent, uri: string) => void, options?)` は**修飾キーの判定を持たない**（`ILinkProviderOptions` は `hover` / `leave` / `urlRegex` のみ）。門はハンドラ側で作るしかない。
- `menu.ts` の原則「キーを実際に拾うのは Renderer の `matchShortcut()` 1箇所。メニューは表示するだけ（`registerAccelerator: false`）」。`role:` は `actionItem()` を通らず、**暗黙のアクセラレータをネイティブに登録する**。

---

## 4. 設計判断履歴

| 日付 | 判断 | 根拠 | 代替案 |
|---|---|---|---|
| 2026-08-04 | 逃がし先の設置を `src/main/external-links.ts` の1関数に集約し、`index.ts` と `settings-window.ts` の両方から呼ぶ | ウィンドウ生成点が2つあり、片方に付け忘れると穴が残る。将来ウィンドウが増えたときに「呼ぶ関数が1つある」ほうが漏れにくい | 各ファイルに直接 `win.webContents.setWindowOpenHandler(...)` を書く（2箇所に同じ判定が散る） |
| 2026-08-04 | `openExternal` に渡す前にスキームを allowlist で絞り、判定は純粋関数に切り出す | 開いた先は Playwright から観測できない（本物のブラウザが起動する）。`dock.bounce` / `context-menu.ts` と同じ扱いで、判定の正を `test/unit/` に置く | E2E で `shell.openExternal` を差し替えて観測するだけ（スキームの網羅は E2E では書けない） |
| 2026-08-04 | **周3（「ウィンドウ」メニューへの `role: 'close'`）は、計画ゲートで実施可否を判断する** | 下の「周3 の前提が実コードとずれている」を参照 | - |

---

## 5. 計画書の前提と実コードのずれ（着手前の測り直し）

`loop.md` の計画ゲートに従い、Issue #178 / #174 本文の現状認識を実コードで測り直した。

| Issue の記述 | 実測結果 |
|---|---|
| `setWindowOpenHandler` がアプリ全体に0件 | **正しい**（`grep -rn setWindowOpenHandler src/` が0件） |
| `WebLinksAddon` に `metaKey` / `ctrlKey` / `altKey` の判定が0件 | **正しい**（`useTerminal.ts` のハンドラは第1引数を `_event` として捨てている） |
| 「設定ウィンドウを `Cmd+W` で閉じられない問題も同時に直る」 | **ずれている。** `SettingsPanel.tsx` の `useEffect` が `Escape` と `Cmd+W` を capture フェーズで拾って `onClose()` を呼んでいる。設定ウィンドウは既に `Cmd+W` で閉じる |
| 「`Cmd+W` が効かないので信号機をマウスで押すしかない」 | **リンクで開いた窓については正しい**（その窓には Renderer の keydown リスナーが無い）。ただし周1 を入れると**その窓自体が生まれない**ので、動機が消える |
| 「`test/unit/menu-accelerators.test.ts`（#144）が二重発火を固定する」 | **成り立たない。** 当該テストの冒頭に「**`role:` が暗黙に持つ accelerator は、この検査の対象外**。ソースに `accelerator:` の文字が現れないので原理的に拾えない」と明記されている |

### `role: 'close'` を足すと何が起きるか

Electron の `role: 'close'` は既定アクセラレータ `CommandOrControl+W` を持ち、`actionItem()` を通らないため
`registerAccelerator: false` が付かない。つまり**ネイティブに登録される**。

現状 `Cmd+W` は Renderer の `matchShortcut()` が `close-pane`（ペインを閉じる。1枚ならタブごと）に割り当てている。
そこへ `role: 'close'` を足すと、**本体ウィンドウで `Cmd+W` を押した瞬間にウィンドウごと閉じる**（= 全タブの PTY が落ちる）。
`registerAccelerator: false` を付ければ二重発火は防げるが、**その場合は子ウィンドウでも `Cmd+W` が効かない**ので、
足す意味そのものが消える。両立しない。
