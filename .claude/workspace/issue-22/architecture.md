# Architecture

Issue #22 における変更対象の構造。
設計判断の根拠は末尾の「設計判断履歴」を参照。

---

## 1. 対象トラック

main（メニュー定義）+ renderer（操作の実行）の2トラック。

| コンポーネント | 変更内容 | 影響範囲 |
|---|---|---|
| `src/main/menu.ts` | **新規**。メニューの組み立てと Renderer への push | `src/main/index.ts` |
| `src/main/index.ts` | 変更（メニュー登録。`activate` での再生成時にも張り直す） | - |
| `src/shared/ipc.ts` | 変更（`AppAction` / `IpcEvent.menuAction` / `RendererApi.menu`） | preload・Renderer 全体 |
| `src/preload/index.ts` | 変更（`menu.onAction` を `subscribe` で実装） | Renderer |
| `src/renderer/src/App.tsx` | 変更（`runAction()` に処理を集約し、キーボードとメニューの両方から呼ぶ） | - |
| `src/renderer/src/lib/shortcuts.ts` | 変更（`AppAction` を参照。`Cmd+K` を clear に、AI 起動を `Cmd+Shift` 系へ） | `useTerminal.ts` の xterm 素通し判定 |
| `src/renderer/src/terminal/useTerminal.ts` | 変更（`TerminalHandle.clear()` を追加） | `TerminalPane.tsx` |
| `e2e/specs/S36-application-menu.spec.ts` | **新規** | `e2e/scenarios.yml`（check2 で必須） |
| `e2e/specs/S09,S10,S11,S15` / `screenshots.spec.ts` | 変更（キーの追従） | `docs/images/S09-launch-claude.png` |
| `README.md` / `test/unit/renderer-lib.test.ts` | 変更 | - |

---

## 2. Contract（src/shared/ipc.ts）変更

| チャンネル / 型 | 変更 | 内容 |
|---|---|---|
| `AppAction` | ADD | メニューとキーボードで共有する操作の語彙。`clear-terminal` を新設 |
| `IpcEvent.menuAction` | ADD | `menu:action`。Main -> Renderer の push |
| `RendererApi.menu.onAction` | ADD | 購読解除関数を返す（既存の `subscribe` ヘルパを再利用） |

新規の invoke / send チャンネルは無い（push 1本のみ）。

---

## 3. 技術的制約・前提条件

- **鉄則1（Renderer は OS を直接触らない）**: メニューは OS のリソースなので Main が持つ。Renderer は `AppAction` を受け取るだけ
- **鉄則3（IPC の型は `src/shared/ipc.ts` が単一の正）**: `ShortcutAction` を Renderer 内で独立定義していたのをやめ、`AppAction` を shared に置いて両方から参照する
- **キーの登録は1箇所だけ**: メニューの accelerator は `registerAccelerator: false`（表示専用）。実際に拾うのは Renderer の `matchShortcut()`。両方が登録すると `Cmd+T` 一回でタブが2枚開く
- **`Cmd+K` は PTY に何も送らない**: xterm の `clear()` は表示とスクロールバックだけを消す。シェルの状態も実行中のプロセスも変えない（鉄則2の境界を越えない）
- **E2E の限界**: Playwright の `keyboard.press()` は Renderer に合成キーを送るだけで、ネイティブメニューの accelerator 経路を通らない。**二重発火は E2E では検出できない**

---

## 4. 設計判断履歴

| 日付 | 判断 | 根拠 | 代替案 |
|---|---|---|---|
| 2026-07-29 | メニューの accelerator を `registerAccelerator: false` にし、キーの実行は Renderer に一本化する | 発見可能性（メニューにキーが載る）と、単一の発火経路を両立できる唯一の形。Electron のこのオプションはまさにこの用途のためにある | メニューにキーを登録し、Renderer 側の処理を消す（メニュー accelerator が本当にキーを消費するかの前提に依存し、外れると全ショートカットが無反応になる） |
| 2026-07-29 | `ShortcutAction` を `src/shared/ipc.ts` の `AppAction` に移す | メニューとキーボードは同じ操作の別の入口。語彙が2箇所に分かれると、片方にだけ操作が増えて「メニューに無いショートカット」や「キーの無いメニュー項目」ができる | Renderer 側に残したまま Main が文字列を送る（型が効かない） |
| 2026-07-29 | 再読み込みと DevTools を開発時のみメニューに残す | 本番で `Cmd+R` を押されると全タブの表示が消える。一方、開発中に再読み込みできないのは不便 | 完全に削除する（開発体験が落ちる） |
| 2026-07-29 | `Cmd+1`〜`Cmd+9` はメニューに載せない | 9項目がウィンドウメニューを埋める割に、発見される価値が薄い。README には残す | すべて載せる |
| 2026-07-29 | S36 で `registerAccelerator` の検査を行わない | `MenuItem` インスタンスから読めず、**実測で全項目 undefined** になった。読めない値を検査すると、常に緑の無意味なテストになる | 何らかの方法で検査を通す（値が取れない以上できない） |
| 2026-07-29 | 二重発火の確認を手動検証に落とす | E2E の合成キーはネイティブメニューを通らないため、構造上検出できない。**検出できないものを「検証済み」として記録しない** | E2E で担保したことにする（緑になるが何も見ていない） |
