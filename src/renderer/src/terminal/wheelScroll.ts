// 代替画面バッファ（tmux / vim / less / htop、および既定で tmux にラップされる
// claude・gemini タブ）でのホイールを、何行ぶんの矢印キーに変換するか。
//
// **xterm.js 6.0.0 の既定は「ホイール1イベント = 矢印1個」に退化している。**
// `CoreBrowserTerminal.ts` の wheel ハンドラは、スクロールすべき行数を
// `coreMouseService.consumeWheelEvent()` で計算しておきながら **0 かどうかの判定にしか使わず**、
// 実際に送るのは矢印1個だけ。上流のコメント自身が
//
//   > This used implementation used get the actual lines/partial lines scrolled from the
//   > viewport but since moving to the new viewport implementation has been simplified to
//   > simply send a single up or down sequence.
//
// と退化を自認している（5系は `for (let i = 0; i < Math.abs(amount); i++)` で行数ぶん送っていた）。
//
// このアプリは `useTmux` が既定 true（`src/shared/defaults.ts`）で claude / gemini タブを
// 常に tmux でラップするため、**AI タブは必ずこの経路に落ちる**。マウスホイールを1ノッチ
// 回すと本来6行前後動くところが1行しか進まず、「スクロールしにくい」になる。
//
// **判定だけを純粋関数として切り出す理由**は `linkActivation.ts` と同じで、ホイールの物理量
// （`deltaMode` の3種・トラックパッド判定・端数の繰り越し）は Playwright から作り分けられない。
// E2E から見えるのは「ハンドラが刺さっているか」までで、1ノッチで何行進むかは観測できない。
// 網羅は `test/unit/wheel-scroll.test.ts` が固定する。
//
// ⛔ **通常バッファには介入しない。** そちらは xterm の `Viewport` が
// `scrollSensitivity` ごと正しく処理しており、壊れていない。
//
// ⛔⛔ **マウス報告を要求しているアプリにも介入しない**（Issue #251。判定は
// `shouldConvertWheelToArrows`）。ここを間違えると**矢印を送るどころか、本来届くはずの
// マウス報告を握り潰す**。詳細はその関数のコメント。

/**
 * xterm の `Terminal.buffer.active.type`。
 *
 * `alternate` は代替画面バッファ（スクロールバックを持たない）。
 */
export type BufferType = 'normal' | 'alternate';

/**
 * xterm の `Terminal.modes.mouseTrackingMode`。
 *
 * `Terminal.ts` の `get modes()` が `coreMouseService.activeProtocol` を写しているだけなので、
 * プロトコルとの対応は 1:1（`X10` / `VT200` / `DRAG` / `ANY`、未設定なら `none`）。
 */
export type MouseTrackingMode = 'none' | 'x10' | 'vt200' | 'drag' | 'any';

/**
 * ホイールイベントを**含む**マウスプロトコル（`CoreMouseService.ts` の `DEFAULT_PROTOCOLS`）。
 *
 * ⚠ **`x10` は含まない。** `X10` の `events` は `DOWN` だけで、ホイールを報告しない。
 */
const MOUSE_MODES_WITH_WHEEL: readonly MouseTrackingMode[] = ['vt200', 'drag', 'any'];

/**
 * このホイールイベントを矢印キーへ変換して**よい**か。
 *
 * ⭐ **`useTerminal` のカスタムハンドラは、この関数が `true` を返すときだけ介入する。**
 * `false` のときは `true`（＝「処理していない」）を xterm へ返し、既定の経路に任せる。
 *
 * ## なぜマウス報告の有無を見るのか（#238 の注意書きの訂正）
 *
 * PR #238 は「マウス報告 ON ならカスタムハンドラにはそもそも来ないので、
 * `mouseTrackingMode` を自前で見るな」と書いていた。**これは誤り。**
 * xterm.js 6.0.0 の `CoreBrowserTerminal.ts` には wheel の経路が2本ある。
 *
 * | 経路 | 走る条件 | カスタムハンドラ |
 * |---|---|---|
 * | 要素の `wheel` リスナー | `requestedEvents.wheel` が無い（マウス報告 OFF / `x10`） | 呼ぶ |
 * | `eventListeners.wheel` -> `sendEvent()` | マウス報告 ON でホイールを含むプロトコル | **`case 'wheel':` の冒頭で呼び、`false` なら報告を送らず return する** |
 *
 * つまりマウス報告 ON でも**必ず呼ばれる**。そこで無条件に `false` を返していたため、
 * **Claude Code が要求していた SGR マウス報告が1つも PTY へ届かず**、代わりに矢印が
 * 最大 `rows` 本流れていた。CLI 側は同方向の矢印を 100ms 以内に 8 本以上受け取ると
 * 「ホイールが矢印を送っている」と判定し、`use PgUp/PgDn to scroll` を出す。
 *
 * ## なぜ `none` と `x10` では変換を続けるのか
 *
 * #238 が心配していた「wheel を要求しないモードで xterm 既定の**矢印1個**に落ちて
 * かえって悪化する」は本物。ホイールを含むプロトコルだけを外せば、`less` / `vim`
 * （`set mouse=` 無し）での改善はそのまま残る。
 */
export function shouldConvertWheelToArrows(
  bufferType: BufferType,
  mouseTrackingMode: MouseTrackingMode,
): boolean {
  // 通常バッファは xterm の Viewport が正しく処理している。触らない。
  if (bufferType !== 'alternate') return false;
  // アプリ自身がホイールを欲しがっているなら、こちらは何もしない。
  if (MOUSE_MODES_WITH_WHEEL.includes(mouseTrackingMode)) return false;
  return true;
}

/**
 * `WheelEvent.deltaMode` の値。
 *
 * DOM の定数（`WheelEvent.DOM_DELTA_*`）を直接読まずに再掲する。この関数は
 * `environment: 'node'` の vitest から呼ばれるため、`WheelEvent` が存在しない。
 */
export const DELTA_MODE_PIXEL = 0;
export const DELTA_MODE_LINE = 1;
export const DELTA_MODE_PAGE = 2;

/**
 * xterm の `scrollSensitivity` 既定値。このアプリは Terminal のオプションを
 * 明示指定していないので既定のまま。通常バッファ側の体感と揃えるために同じ値を使う。
 */
const SCROLL_SENSITIVITY = 1;

/**
 * xterm の `fastScrollSensitivity` 既定値。Alt / Ctrl を押しながらのホイールで倍速になる。
 *
 * **Shift は含めない。** xterm 自身が `consumeWheelEvent` の冒頭で `ev.shiftKey` を
 * 「横スクロール」として 0 行に倒しており、倍速の対象にすると辻褄が合わない。
 */
const FAST_SCROLL_SENSITIVITY = 5;

/**
 * これ未満の `|deltaY|`（CSS ピクセル）はトラックパッドの慣性スクロールとみなす閾値。
 * xterm の `isLikelyTrackpad` と同じ判定を使う。
 */
const TRACKPAD_DELTA_THRESHOLD = 50;

/**
 * トラックパッドと判定したときの減衰率。xterm と同じ 0.3。
 *
 * トラックパッドは1ジェスチャで大量のイベントを撃つため、素の行数を送ると
 * 画面が吹き飛ぶ。端数は `carry` に溜まるので、減衰させても総量は失われない。
 */
const TRACKPAD_DAMPING = 0.3;

/** ホイールイベントのうち、変換に必要な分だけ受け取る。 */
export type WheelInput = Pick<WheelEvent, 'deltaY' | 'deltaMode' | 'shiftKey' | 'altKey' | 'ctrlKey'>;

export interface WheelGeometry {
  /**
   * 1行の高さ（**CSS ピクセル**）。`container.clientHeight / term.rows` で求める。
   *
   * xterm 内部は「デバイスピクセルの実セル高 / dpr」を使っているが、これは
   * CSS ピクセルの行高そのもの。`getCellMetrics()` と同じ逆算で得られるので、
   * 公開 API に無い `_renderService.dimensions` に触らずに済む。
   */
  cellHeightCssPx: number;
  /** 端末の行数。`DOM_DELTA_PAGE` の換算と、1イベントあたりの上限に使う。 */
  rows: number;
}

export interface WheelScrollResult {
  /**
   * 送る矢印キーの本数。**正なら下（`B`）、負なら上（`A`）、0 なら何も送らない。**
   */
  lines: number;
  /**
   * 次の呼び出しへ繰り越す端数（絶対値が 1 未満）。呼び出し側が保持して渡し直す。
   *
   * これを捨てると、1行に満たない小さなホイールが**永久に無視される**
   * （トラックパッドはこの領域にしか来ないことがある）。
   */
  carry: number;
}

/**
 * ホイール1イベントを、代替画面バッファへ送る矢印キーの本数に変換する。
 *
 * xterm の `CoreMouseService.consumeWheelEvent` と同じ換算を行い、**その結果を
 * 1本に潰さずそのまま返す**のが既定との唯一の違い。
 *
 * 何も送らない（`lines: 0`）ケース:
 * - 縦の移動が無い / `Shift`（横スクロール）
 * - 幾何が取れていない（マウント直後や非表示ペインで `clientHeight` が 0）
 * - 端数が 1 行に届かなかった（`carry` に積まれ、次のイベントで消化される）
 */
export function consumeWheelScroll(
  input: WheelInput,
  geometry: WheelGeometry,
  carry: number,
): WheelScrollResult {
  const safeCarry = Number.isFinite(carry) ? carry : 0;

  if (!Number.isFinite(input.deltaY) || input.deltaY === 0 || input.shiftKey) {
    return { lines: 0, carry: safeCarry };
  }
  // 幾何が取れていないときは動かさない（鉄則5と同じ、縮退して落とさない方針）。
  if (!Number.isFinite(geometry.cellHeightCssPx) || geometry.cellHeightCssPx <= 0) {
    return { lines: 0, carry: safeCarry };
  }

  const rows = Number.isFinite(geometry.rows) && geometry.rows > 0 ? Math.floor(geometry.rows) : 1;
  const sensitivity =
    input.altKey || input.ctrlKey
      ? SCROLL_SENSITIVITY * FAST_SCROLL_SENSITIVITY
      : SCROLL_SENSITIVITY;

  let amount = input.deltaY * sensitivity;
  let nextCarry = safeCarry;

  if (input.deltaMode === DELTA_MODE_PAGE) {
    amount *= rows;
  } else if (input.deltaMode === DELTA_MODE_PIXEL) {
    amount /= geometry.cellHeightCssPx;
    if (Math.abs(input.deltaY) < TRACKPAD_DELTA_THRESHOLD) amount *= TRACKPAD_DAMPING;
    // 端数の繰り越し。`Math.trunc` は 0 方向に丸めるので、上下どちらでも対称に働く。
    nextCarry = safeCarry + amount;
    amount = Math.trunc(nextCarry);
    nextCarry -= amount;
  }
  // DOM_DELTA_LINE はもともと行数なので、換算せずそのまま使う。

  // **1イベントで1画面ぶんを超えて送らない。** 矢印キーは1本ずつ PTY に流れるので、
  // 上限を置かないと巨大な deltaY（ページ送りや外部デバイス）で数百本を撃ちうる。
  const lines = clamp(Math.trunc(amount), -rows, rows);
  return { lines, carry: nextCarry };
}

/**
 * 行数を、実際に PTY へ送るカーソルキーの列にする。
 *
 * `applicationCursorKeys`（DECCKM）が立っていれば `ESC O A/B`、そうでなければ
 * `ESC [ A/B`。xterm 既定と同じ判定で、tmux も vim も両方の形を出しうる。
 *
 * `deltaY > 0`（下向きのホイール）は下矢印 `B`。xterm の `ev.deltaY < 0 ? 'A' : 'B'` と同じ向き。
 */
export function arrowScrollSequence(lines: number, applicationCursorKeys: boolean): string {
  if (!Number.isInteger(lines) || lines === 0) return '';
  const prefix = applicationCursorKeys ? '\x1bO' : '\x1b[';
  const key = lines > 0 ? 'B' : 'A';
  return (prefix + key).repeat(Math.abs(lines));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
