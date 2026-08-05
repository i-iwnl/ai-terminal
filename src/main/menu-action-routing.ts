// メニューの独自アクションを、どのウィンドウへ向けるかの判定（Issue #152）。
//
// **なぜ判定を純粋関数へ切り出すか。** この判定の入力は
// `BrowserWindow.getFocusedWindow()` = **OS のフォーカス**で、E2E からは
// 原理的に踏めない。`e2e/fixtures/harness.ts` は開発者のエディタから
// フォーカスを奪わないために **`BrowserWindow.prototype.focus` を noop へ
// 差し替え、全ウィンドウを `hide()` し `dock.hide()` している**ため、
// 設定ウィンドウを開いても `getFocusedWindow()` は **常に `null`** を返す
// （`app.focus({ steal: true })` を挟んでも変わらないことを実測した）。
//
// つまり「設定にフォーカスがある状態でメニューを押す」という前提条件を
// E2E の中で作れない。そこで書いた検査は**前提を踏まないまま必ず通る**
// （恒真の関門）。判定だけをここへ出し、`test/unit/menu-action-routing.test.ts`
// で固定する。`isSafeExternalUrl` / `describeSpawnError` / `shouldSendResize` と
// 同じ扱い（このリポジトリが繰り返し採ってきた形）。
//
// **通常起動の Electron では `getFocusedWindow()` は正しく追従する**ことも
// 実測済み（`parent` 付きの子ウィンドウが生成時にフォーカスを取り、
// `親.focus()` で親へ戻る = 設定ウィンドウそのものの状況）。
// 実挙動の最終確認は人力（#195）。

/** メニュー項目のクリックを、どこへ向けるか。 */
export type MenuActionRoute =
  /** 本体ウィンドウの Renderer へ送る。 */
  | 'send'
  /** 送らずに本体ウィンドウを前に出す（別ウィンドウにフォーカスがある）。 */
  | 'focus-main'
  /** 何もしない（本体ウィンドウが既に無い）。 */
  | 'ignore';

export interface MenuActionContext {
  /** 本体ウィンドウの id。破棄済みなら `null`（破棄後は `id` を読めない）。 */
  mainWindowId: number | null;
  /** クリック時点で OS フォーカスを持つウィンドウの id。誰も持たなければ `null`。 */
  focusedWindowId: number | null;
}

/**
 * メニューの独自アクションの宛先を決める。
 *
 * **`focusedWindowId === null` は「送る」に倒す。** 誰もフォーカスを持たない状態で
 * メニュー項目が発火するのは、(a) E2E ハーネス（`MenuItem.click()` を直接叩く）と
 * (b) アプリが非アクティブなときで、**どちらも「設定ウィンドウからの誤操作」ではない**。
 * ここを `focus-main` に倒すと、メニュー経由の既存シナリオ（S60 / S61 / S77 / S85）が
 * まとめて動かなくなる = **実際にアプリの機能を殺す**。
 *
 * **別ウィンドウにフォーカスがあるときは、前に出すだけで送らない。**
 * 送ってしまうと「ファイル > ペインを閉じる」で裏の PTY が死ぬという
 * Issue #152 の実害がそのまま残る（前に出してから送る案は、
 * 見えるようになるだけで止まらない）。ユーザーは本体が前に出た状態で
 * もう一度選び直せる。
 */
export function routeMenuAction(ctx: MenuActionContext): MenuActionRoute {
  if (ctx.mainWindowId === null) return 'ignore';
  if (ctx.focusedWindowId === null) return 'send';
  return ctx.focusedWindowId === ctx.mainWindowId ? 'send' : 'focus-main';
}
