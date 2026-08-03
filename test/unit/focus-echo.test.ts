import { describe, expect, it } from 'vitest';
import { createFocusEchoGate } from '../../src/renderer/src/terminal/focusEcho';

/**
 * Issue #120 C-1: 分割直後の `Cmd+]` が負荷下でのみ効かないことがある。
 *
 * 原因は「プログラム的な `focus()` のこだまが、遅れて届いてキーボード由来の
 * アクティブ変更を上書きする」こと（観測ログは `focusEcho.ts` のコメントが正）。
 *
 * **競合そのものは E2E では決定的に再現できない**（React 18 の passive effect の
 * フラッシュが遅れるかどうかはスケジューラ次第で、負荷をかけて確率を上げることしか
 * できない）。判定を純粋関数へ切り出して直接固定するのは、このリポジトリで
 * 8回繰り返してきた作法（`shouldSendResize` / `computeYourTurnSince` /
 * `rovingTabindex` / `passesModifierGate` / `paneTree` / `paneHeader` /
 * `paneSplitter` / `chromeTextRemainsReadable`）。
 */
describe('createFocusEchoGate', () => {
  it('何もしていないときは focus をアクティブ変更として通す', () => {
    const gate = createFocusEchoGate();
    expect(gate.shouldActivate()).toBe(true);
  });

  it('run() の内側で起きた focus は捨てる（プログラム的 focus のこだま）', () => {
    const gate = createFocusEchoGate();
    const observed: boolean[] = [];
    gate.run(() => {
      // focus() が同期で配送する focus イベントは、この位置で観測される。
      observed.push(gate.shouldActivate());
    });
    expect(observed).toEqual([false]);
  });

  it('run() を抜けたら、次の focus は通す（1回ぶんだけ飲み込む）', () => {
    const gate = createFocusEchoGate();
    gate.run(() => {
      /* この中のこだまは捨てられる */
    });
    // クリック由来の focus はこの後に来る。捨ててはいけない。
    expect(gate.shouldActivate()).toBe(true);
  });

  it('run() の中身が例外を投げても窓は閉じる（門が開きっぱなしにならない）', () => {
    const gate = createFocusEchoGate();
    expect(() =>
      gate.run(() => {
        throw new Error('focus に失敗した');
      }),
    ).toThrow('focus に失敗した');
    // ここで false のままだと、以降クリックしてもペインが切り替わらなくなる
    // （不具合を別の不具合と交換することになる）。
    expect(gate.shouldActivate()).toBe(true);
  });

  it('run() を入れ子にしても、最も外側を抜けるまで捨て続ける', () => {
    const gate = createFocusEchoGate();
    const observed: boolean[] = [];
    gate.run(() => {
      gate.run(() => observed.push(gate.shouldActivate()));
      // 内側の run() を抜けた直後もまだプログラム的 focus の最中。
      observed.push(gate.shouldActivate());
    });
    observed.push(gate.shouldActivate());
    expect(observed).toEqual([false, false, true]);
  });

  it('門番はペインごとに独立している（隣のペインの focus を巻き添えにしない）', () => {
    const left = createFocusEchoGate();
    const right = createFocusEchoGate();
    const observed: boolean[] = [];
    left.run(() => observed.push(right.shouldActivate()));
    expect(observed).toEqual([true]);
  });
});
