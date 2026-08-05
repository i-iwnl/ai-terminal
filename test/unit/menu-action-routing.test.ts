// メニューの独自アクションの宛先判定（src/main/menu-action-routing.ts。Issue #152）。
//
// **なぜ E2E ではなくここで固定するのか。** 判定の入力は OS のフォーカスで、
// E2E からは前提条件を作れない。`e2e/fixtures/harness.ts` が
// `BrowserWindow.prototype.focus` を noop に差し替え、全ウィンドウを隠し、
// `dock.hide()` しているため、**設定ウィンドウを開いても
// `BrowserWindow.getFocusedWindow()` は常に `null`** を返す（実測）。
// この状態で「設定にフォーカスがあるとき送らない」を検査しても、
// 前提を一度も踏まずに必ず通る = 恒真の関門になる。
//
// **ハーネスを直す道は採らない。** 非表示化は「開発者のエディタから
// フォーカスを奪わない」ための意図的な設計で、外すと E2E 全体の前提が変わる。

import { describe, expect, it } from 'vitest';
import { routeMenuAction } from '../../src/main/menu-action-routing';

const MAIN = 1;
const SETTINGS = 2;

describe('routeMenuAction', () => {
  it('本体ウィンドウにフォーカスがあるときは送る（通常の操作）', () => {
    expect(routeMenuAction({ mainWindowId: MAIN, focusedWindowId: MAIN })).toBe('send');
  });

  it('設定ウィンドウにフォーカスがあるときは送らず、本体を前に出す（Issue #152 の本体）', () => {
    // 送ってしまうと「ファイル > ペインを閉じる」で裏の PTY が黙って死ぬ。
    expect(routeMenuAction({ mainWindowId: MAIN, focusedWindowId: SETTINGS })).toBe('focus-main');
  });

  it('誰もフォーカスを持たないときは送る（E2E ハーネスと、アプリが非アクティブな場合）', () => {
    // ⛔ ここを 'focus-main' に倒すと、メニュー経由の既存シナリオ
    // （S60 / S61 / S77 / S85）がまとめて動かなくなる。
    expect(routeMenuAction({ mainWindowId: MAIN, focusedWindowId: null })).toBe('send');
  });

  it('本体ウィンドウが既に無いときは何もしない', () => {
    // 破棄後は `win.id` を読めないので、呼び出し側は null を渡す。
    expect(routeMenuAction({ mainWindowId: null, focusedWindowId: SETTINGS })).toBe('ignore');
    expect(routeMenuAction({ mainWindowId: null, focusedWindowId: null })).toBe('ignore');
  });

  it('id の一致だけで決める（別ウィンドウが本体と同じ id を持つことはない）', () => {
    // 将来ウィンドウが3枚以上になっても、本体以外はすべて focus-main に落ちる。
    for (const focusedWindowId of [SETTINGS, 3, 42]) {
      expect(routeMenuAction({ mainWindowId: MAIN, focusedWindowId })).toBe('focus-main');
    }
  });
});
