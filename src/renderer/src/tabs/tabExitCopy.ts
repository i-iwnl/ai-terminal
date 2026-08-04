// 終了状態を画面に出す語（純粋関数。Issue #166）。
//
// **なぜ語を分けるか。** 直す前はタブも、ペインの読み上げも、一律「終了」だった。
// これは `src/main/menu.ts` の `${appName} を終了`（アプリを終了するメニュー項目）と
// **同じ語**で、しかもタブでは `<button role="tab">` の中にある。
// 押せる要素の中に置かれた「終了」は「押すと終了する」と読める。
// `src/renderer/src/tabs/closeTabCopy.ts` は確認ダイアログの実行ボタンに
// `終了する` を使っているので、**同じウィンドウの中で実際に衝突している**。
//
// **`強制終了` は使わない**（design-review で5人全員が却下した）。
// macOS の Apple メニューにある実コマンド名（Force Quit）で、`終了` を捨てた理由
// （押せる要素の中で動詞に読める）が**より強い破壊的動詞のまま当てはまる**。
// 事実としても不正確で、SIGHUP / SIGPIPE は「強制」ではない。
//
// **`完了` も使わない。** `src/main/agents/poller.ts` が「Claude の作業が完了しました」を
// 通知に出しており、あちらは「プロセスが終わった」ではなく**あなたの番**を意味する。
//
// **可視の語は4文字で固定する。** `終了（コード 1）` のような可変長にすると、
// タブが `max-width: 180px` まで膨らんで右隣以降のタブが横滑りし、
// タイトルが省略記号だけになる（design-review で実測）。しかも
// `コード 1` と `コード 130` で幅が変わるので、**同じ状態が桁数でレイアウトを変える**。
// 生値（コード / シグナル）は `aria-label` と `title` にだけ入れる。
// ペイン本文（`terminal/useTerminal.ts`）と通知バナーが既に生値を出しているので、
// 可視の4層目に同じ数字を並べる必要は無い。

import { isAbnormalExit, type PtyExitLike } from '@shared/pty-exit';
import { flattenPaneTree, type PaneNode } from './paneTree';
import { tabExitState } from './tabPane';

/**
 * 終了1件の**可視の語**（4文字固定）。
 *
 * 「異常か」の判定は書かない。唯一の正は `@shared/pty-exit` の `isAbnormalExit()`。
 */
export function exitWord(exit: PtyExitLike): string {
  return isAbnormalExit(exit) ? '異常終了' : '終了済み';
}

/**
 * 終了1件の**生値つきの語**（`aria-label` / `title` 用）。
 *
 * **可視の語（`exitWord`）を必ず先頭に含む。** 含めないと、可視テキストが
 * アクセシブルネームの部分文字列でなくなり WCAG 2.5.3（Label in Name）を割る
 * （音声操作で「異常終了」と言っても押せなくなる）。
 * `TabBar.tsx` が可視テキストを先頭に置いているのと同じ規律。
 *
 * シグナルとコードの語形は `terminal/useTerminal.ts` がスクロールバックへ書く
 * 文言に揃える（同じ事象について、同じウィンドウの中で語彙を2つ作らない）。
 */
export function exitDetail(exit: PtyExitLike): string {
  if (!isAbnormalExit(exit)) return exitWord(exit);
  return exit.signal !== undefined && exit.signal !== 0
    ? `${exitWord(exit)}（シグナル ${exit.signal}）`
    : `${exitWord(exit)}（コード ${exit.exitCode}）`;
}

export interface TabExitCopy {
  /** 末尾バッジに出す可視の語。4文字固定。 */
  badge: string;
  /** `aria-label` / `title` に入れる、生値つきの語。 */
  detail: string;
}

/**
 * タブ（＝ペインの木）に対する終了の語。まだ生きているペインがあれば `undefined`。
 *
 * **代表に選ぶのは「異常があればその1枚目」。** タブの severity は `some` 集約
 * （`tabExitState`）なので、語もそれに合わせないと
 * 「タブは赤いのに、読み上げは『終了済み』と言う」という食い違いが出る。
 */
export function tabExitCopy(layout: PaneNode): TabExitCopy | undefined {
  const state = tabExitState(layout);
  if (state === 'running') return undefined;

  const exits = flattenPaneTree(layout)
    .map((leaf) => leaf.exit)
    .filter((exit): exit is PtyExitLike => exit !== undefined);
  const representative = exits.find((exit) => isAbnormalExit(exit)) ?? exits[0];
  // `state !== 'running'` = 全ペインが終了しているので、ここは必ず1件以上ある。
  // 木が空という外部からの回り込みだけを畳んでおく（鉄則5）。
  if (representative === undefined) return undefined;

  return { badge: exitWord(representative), detail: exitDetail(representative) };
}
