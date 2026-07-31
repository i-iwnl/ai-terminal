// 「直前のタブへ戻る」（Cmd+E。Issue #20 J）のための、最近アクティブだった
// タブ ID の履歴。
//
// 単純に「1つ前の1個」だけを覚えると、そのタブが既に閉じられていた場合に
// 戻り先が無くなる。直近に active だった順の履歴（LRU）を持ち、閉じられた
// タブは呼び出し側が渡す「今も存在するタブの id 集合」でフィルタして読み飛ばす。

export type TabHistory = readonly string[];

/** 際限なく伸びないための上限。通常の利用でここに達することはまず無い。 */
const MAX_HISTORY = 32;

/**
 * アクティブなタブが変わるたびに呼ぶ。同じ id が末尾に既にある（アクティブなタブが
 * 変わっていない）場合は何もしない。既に履歴の途中にある id が再びアクティブに
 * なった場合は、その古い出現を消して末尾へ積み直す（LRU）。
 */
export function recordActiveTab(history: TabHistory, activeTabId: string | null): TabHistory {
  if (activeTabId === null) return history;
  if (history[history.length - 1] === activeTabId) return history;
  const next = [...history.filter((id) => id !== activeTabId), activeTabId];
  return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
}

/**
 * 「直前のタブ」を履歴から求める（Cmd+E）。
 *
 * 履歴の末尾は現在アクティブなタブそのもの。その1つ前から遡って、まだ存在する
 * （existingTabIds にある）タブを最初に見つけたものを返す。見つからなければ
 * undefined（履歴が無い、または残っているタブが現在の1枚だけ）。
 *
 * **2回連続で押すと直近2枚をトグルする。** recordActiveTab は呼ばれるたびに
 * 末尾を更新するため、A -> E で B に移ると履歴は [...,A,B] になり、続けて
 * もう一度 E を押すと今度は A へ戻る（ブラウザの「戻る」と違い、undo スタックの
 * ように深く遡る操作ではない）。
 */
export function previousActiveTab(
  history: TabHistory,
  existingTabIds: ReadonlySet<string>,
): string | undefined {
  for (let i = history.length - 2; i >= 0; i--) {
    if (existingTabIds.has(history[i])) return history[i];
  }
  return undefined;
}
