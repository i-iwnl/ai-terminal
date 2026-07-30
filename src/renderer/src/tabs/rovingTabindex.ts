// タブの roving tabindex（矢印キーで移動する対象を1枚に絞る仕組み）の計算だけを
// 切り出した純粋関数。TabBar.tsx から DOM 操作（フォーカス移動）を剥がした
// 形にしてあるので、境界条件（両端の折り返し・タブ0/1枚）を実 DOM 無しに
// test/unit/ で固定できる。
//
// WAI-ARIA Authoring Practices のタブパターンに合わせ、矢印キーは両端で
// 反対側へ折り返す。
//
// **activation は manual。** 矢印キーは「次にフォーカスすべき添字」を返す
// だけで、選択（onSelect の呼び出し）は行わない。最初は automatic
// activation（移動 = 選択）で実装したが、選択が変わるたびに
// TerminalPane.tsx の既存の仕組みがフォーカスを端末側へ奪ってしまい、
// xterm が Tab を自前で処理するせいでキーボードだけではタブリストへ
// 戻れず、矢印キーでの移動が実質1ホップに制限された（roving tabindex を
// 入れた意味がほぼ無くなる）。WAI-ARIA APG が「activate でフォーカスが
// 移る場合は manual activation」としているとおり、ここはその条件に
// 当てはまる。選択は Enter / Space（ネイティブの button の標準動作）で
// 行う。この関数自体の計算（次の添字）は activation の方式に依存しない
// ため、この関数のシグネチャ・挙動は変えていない。

/** タブの移動に使うキー。矢印キーに加えて Home / End も面倒を見る。 */
export type RovingTabindexKey = 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';

const ROVING_TABINDEX_KEYS: readonly RovingTabindexKey[] = [
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
];

/** キー入力がタブの移動キー（矢印 / Home / End）かどうかを判定する。 */
export function isRovingTabindexKey(key: string): key is RovingTabindexKey {
  return (ROVING_TABINDEX_KEYS as readonly string[]).includes(key);
}

/**
 * 現在フォーカスしているタブの添字（current）とキー、タブの総数（count）から、
 * 次にフォーカスすべき添字を返す（選択は変えない。manual activation）。
 *
 * - ArrowRight: 次のタブへ（末尾なら先頭へ折り返す）
 * - ArrowLeft: 前のタブへ（先頭なら末尾へ折り返す）
 * - Home: 先頭のタブへ
 * - End: 末尾のタブへ
 *
 * count が 0 以下（タブが1枚も無い）場合は current をそのまま返す
 * （呼び出し側で「タブが無ければ何もしない」を毎回書かずに済ませるため）。
 */
export function nextRovingTabindex(
  current: number,
  key: RovingTabindexKey,
  count: number,
): number {
  if (count <= 0) return current;
  switch (key) {
    case 'ArrowRight':
      return (current + 1) % count;
    case 'ArrowLeft':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return current;
  }
}

// タブを閉じるキー（WAI-ARIA APG のタブパターンが推奨する方式）。
//
// レビュー指摘（PR 9 の e2e S51 が検出): 閉じるボタン（.tab-bar__close）に
// tabIndex を明示していなかったため既定値 0 のままで、タブが N 枚あると
// Tab の停止点が「role="tab" 1個 + 閉じるボタン N個」になっていた
// （roving tabindex で「停止点は1つ」にした意味が無い）。
// 閉じるボタン自体は tabIndex={-1} にして停止点から外す一方、
// 「キーボードだけでタブを閉じる」能力を後退させないため、role="tab" の
// ボタンにフォーカスがある状態で Delete / Backspace を押したら
// そのタブを閉じられるようにする。

const CLOSE_TAB_KEYS: readonly string[] = ['Delete', 'Backspace'];

/** キー入力が「フォーカス中のタブを閉じる」キー（Delete / Backspace）かどうかを判定する。 */
export function isCloseTabKey(key: string): boolean {
  return CLOSE_TAB_KEYS.includes(key);
}
