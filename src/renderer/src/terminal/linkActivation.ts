// ターミナル内のリンクを、どのクリックで開くか（Issue #178 周2 / 統合元 #174）。
//
// **素のクリックで開いてはいけない。** `@xterm/addon-web-links` は修飾キーを一切見ずに
// ハンドラを呼ぶので、**カーソルを置くつもりの左クリックでもリンクが発火する**。
// エージェントは PR リンク・localhost・docs を1日中吐くため、URL の上を通る
// 何気ないクリックが1日に何度もブラウザを前に出す。
//
// iTerm2 / Ghostty / Terminal.app はいずれも **Cmd+クリック**を要求する。
// 同じ作法に寄せる（利用者の筋肉記憶がそのまま通る）。
//
// **判定だけを純粋関数として切り出す**理由: 開いた先（既定ブラウザ）は Playwright から
// 観測できず、E2E（S93）が見られるのは「`shell.openExternal` が呼ばれたか」までになる。
// 修飾キーの組み合わせの網羅は `test/unit/link-activation.test.ts` が固定する
// （`passesModifierGate` / `shouldSendResize` と同じ扱い）。

/** クリックの修飾キーと押されたボタン。`MouseEvent` から必要な分だけ受け取る。 */
export type LinkClick = Pick<MouseEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'button'>;

/**
 * そのクリックでリンクを開いてよいか。
 *
 * - **`button === 0`（主ボタン）だけ**。中クリック・右クリックでは開かない
 *   （右クリックはターミナル面のコンテキストメニュー（Issue #135）に割り当て済み）
 * - **`metaKey` が必須**。macOS の Cmd。これが本体
 * - **`ctrlKey` / `altKey` が同時なら開かない**。`Ctrl+クリック` は macOS では
 *   右クリック相当、`Option+ドラッグ` は矩形選択で、どちらも別の意味を持つ
 * - **`shiftKey` は見ない**。`Cmd+Shift+クリック` はブラウザで「背面タブで開く」に
 *   あたる馴染みのある操作で、ここで弾くと理由の説明できない不発になる
 */
export function shouldActivateLink(click: LinkClick): boolean {
  if (click.button !== 0) return false;
  if (!click.metaKey) return false;
  if (click.ctrlKey || click.altKey) return false;
  return true;
}
