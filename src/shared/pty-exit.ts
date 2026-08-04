// PTY の終了イベントの解釈（純粋関数）。**Main と Renderer の両方から使う。**
//
// **なぜ `src/shared/` に置くか**（Issue #133）。
//
// 「異常終了かどうか」の判定は、それまで Renderer 側の
// `src/renderer/src/lib/notices.ts` の `severityForExit()` にしか無かった。
// `src/renderer/` は Main から見えない（`tsconfig.node.json` の `include` は
// `src/main` / `src/preload` / `src/shared` のみで、`paths` も `@shared/*` だけ）。
// そのため Main が Dock を弾ませようとすると、**同じ判定をもう1つ書くことになる**。
// 「異常終了とは何か」に正が2つできると、片方だけ直したときに
// 「バナーはエラーなのに Dock は鳴らない」という食い違いが起きる。
//
// **移したのは「異常か」だけで、severity（`'info' | 'error'`）は移していない。**
// あれは通知バナーの表現であって Main には要らない。`severityForExit()` は
// この判定に委ねる薄いラッパーとして Renderer に残す。
// **1つの事実、2つの表現。**

/** PTY の終了イベントのうち、判定に要る部分だけ。 */
export interface PtyExitLike {
  exitCode: number;
  /** シグナルで終了した場合の番号。**0 は「シグナル無し」を表しうる。** */
  signal?: number;
}

/**
 * 異常終了か。
 *
 * 正常終了は「`exitCode` が 0 で、かつシグナルによる終了でもない」。
 * `signal` は 0 も「シグナル無し」を表しうる値として届くことがあるため、
 * `!== undefined && !== 0` で「実際にシグナルが立っている」ときだけ異常とみなす。
 */
export function isAbnormalExit(event: PtyExitLike): boolean {
  return event.exitCode !== 0 || (event.signal !== undefined && event.signal !== 0);
}

/**
 * Dock を弾ませるべきか（Issue #133）。
 *
 * 条件は2つとも必要:
 *
 * 1. **異常終了であること。** `zsh` に `exit` と打った自分に通知を返すのは
 *    純粋なノイズ。正常終了では鳴らさない
 * 2. **ウィンドウが前に無いこと。** 見ている最中に弾ませても意味が無く、
 *    うるさいだけ（`src/main/agents/poller.ts` の完了通知が既に採っている条件と同じ）
 *
 * **これが解こうとしている問題**: エージェントが落ちても、それまでは
 * アプリの外に何も出なかった。ウィンドウ内には層が3枚ある（通知バナー /
 * タブバーの終了表示 / ペイン内の `[プロセスは終了しました…]`）が、
 * **ウィンドウを見ていない時間帯には1つも届かない**。
 * 「14:00 に落ちて 15:30 に気づく」という形で、ウィンドウ内に層を何枚積んでも
 * この1時間半は1分も縮まらない。
 */
export function shouldBounceOnExit(event: PtyExitLike, windowFocused: boolean): boolean {
  if (windowFocused) return false;
  return isAbnormalExit(event);
}
