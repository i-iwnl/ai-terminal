/**
 * `Cmd+F` で検索バーを開くとき、xterm の選択範囲を検索欄へ引き継ぐかの判定（Issue #175）。
 *
 * ## なぜ判定が要るか
 *
 * macOS には「Use Selection for Find」（`Cmd+E`）があるが、このアプリは `Cmd+E` を
 * **直前のタブへ戻る**に割り当てている（`shortcuts.ts`）。**奪ったまま代替が無い**ので、
 * `Cmd+F` 側で引き継ぐ。**新しいキーは足さない**（#175 の明示指定）。
 *
 * ## 引き継がない場合がある
 *
 * `term.getSelection()` は「選択が無ければ空文字」だけでなく、**空白だけ**や
 * **複数行**も返しうる。どちらも検索語としては使えない:
 *
 * - **空白だけ**: 端末の行は右端まで空白で埋まっているので、行末の余白を撫でただけで
 *   空白の塊が取れる。それを検索欄に入れると、**前回の検索語を意味の無い空白で上書きする**
 * - **複数行**: `@xterm/addon-search` は行をまたいだ一致を扱えない。入れても必ず0件になり、
 *   しかも**引き継がなければ使えたはずの前回の語が消える**
 *
 * **引き継がない = 検索欄を触らない**（空にするのではない）。既に入っている語は残す。
 */

/**
 * 選択範囲から検索欄へ入れる語を決める。引き継がないときは `null`。
 *
 * 前後の空白は落とす（行の右端まで撫でたときの余白を検索語に含めない）。
 * **中の空白は残す**（`git status` のような語句をそのまま探せる）。
 */
export function searchSeedFromSelection(selection: string | undefined | null): string | null {
  if (!selection) return null;
  // 改行を含む選択は、検索アドオンが行をまたげないので引き継がない。
  if (/[\r\n]/.test(selection)) return null;
  const trimmed = selection.trim();
  return trimmed === '' ? null : trimmed;
}
