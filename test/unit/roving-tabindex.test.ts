// タブバーの roving tabindex（矢印キーで次にフォーカスすべきタブを決める）計算と、
// フォーカス中のタブを閉じるキー（Delete / Backspace）の判定。
//
// 実際にキーボードでタブに到達できるかどうかは e2e（S51）が担保するが、
// 「両端で折り返す」「タブが1枚 / 0枚」といった境界条件は、実 DOM 無しに
// ここで固定しておく。
//
// isCloseTabKey は e2e の S51 が検出したレビュー指摘（閉じるボタンに
// tabIndex を明示していなかったため、roving tabindex の「停止点は1つ」が
// タブ N 枚で「1 + N」に崩れていた）を受けて追加した。閉じるボタンを
// tabIndex={-1} で停止点から外す代わりに、role="tab" のボタンにフォーカスが
// ある状態で Delete / Backspace を押すとタブを閉じられるようにする
// （WAI-ARIA APG のタブパターンが推奨する方式）。

import { describe, expect, it } from 'vitest';
import {
  isCloseTabKey,
  isRovingTabindexKey,
  nextRovingTabindex,
} from '../../src/renderer/src/tabs/rovingTabindex';

describe('isRovingTabindexKey', () => {
  it('矢印キーと Home / End をタブ移動キーと判定する', () => {
    expect(isRovingTabindexKey('ArrowRight')).toBe(true);
    expect(isRovingTabindexKey('ArrowLeft')).toBe(true);
    expect(isRovingTabindexKey('Home')).toBe(true);
    expect(isRovingTabindexKey('End')).toBe(true);
  });

  it('タブ移動と無関係なキーは判定しない', () => {
    // Tab / Shift+Tab はブラウザ既定のフォーカス移動に任せる（roving tabindex が
    // 「タブリスト全体で1停止」を実現する経路そのもの）ので、ここでは奪わない。
    expect(isRovingTabindexKey('Tab')).toBe(false);
    expect(isRovingTabindexKey('Enter')).toBe(false);
    expect(isRovingTabindexKey(' ')).toBe(false);
    expect(isRovingTabindexKey('a')).toBe(false);
    // 縦方向の矢印はタブバー（水平）では使わない。
    expect(isRovingTabindexKey('ArrowUp')).toBe(false);
    expect(isRovingTabindexKey('ArrowDown')).toBe(false);
  });
});

describe('nextRovingTabindex', () => {
  it('ArrowRight で次のタブへ進む', () => {
    expect(nextRovingTabindex(0, 'ArrowRight', 3)).toBe(1);
    expect(nextRovingTabindex(1, 'ArrowRight', 3)).toBe(2);
  });

  it('ArrowRight は末尾で先頭へ折り返す', () => {
    expect(nextRovingTabindex(2, 'ArrowRight', 3)).toBe(0);
  });

  it('ArrowLeft で前のタブへ戻る', () => {
    expect(nextRovingTabindex(2, 'ArrowLeft', 3)).toBe(1);
    expect(nextRovingTabindex(1, 'ArrowLeft', 3)).toBe(0);
  });

  it('ArrowLeft は先頭で末尾へ折り返す', () => {
    expect(nextRovingTabindex(0, 'ArrowLeft', 3)).toBe(2);
  });

  it('Home は常に先頭のタブへ', () => {
    expect(nextRovingTabindex(2, 'Home', 3)).toBe(0);
    expect(nextRovingTabindex(0, 'Home', 3)).toBe(0);
  });

  it('End は常に末尾のタブへ', () => {
    expect(nextRovingTabindex(0, 'End', 3)).toBe(2);
    expect(nextRovingTabindex(2, 'End', 3)).toBe(2);
  });

  it('タブが1枚だけのときは自分自身に折り返す', () => {
    expect(nextRovingTabindex(0, 'ArrowRight', 1)).toBe(0);
    expect(nextRovingTabindex(0, 'ArrowLeft', 1)).toBe(0);
    expect(nextRovingTabindex(0, 'Home', 1)).toBe(0);
    expect(nextRovingTabindex(0, 'End', 1)).toBe(0);
  });

  it('タブが0枚（count が 0 以下）のときは current をそのまま返す', () => {
    expect(nextRovingTabindex(0, 'ArrowRight', 0)).toBe(0);
    expect(nextRovingTabindex(3, 'Home', 0)).toBe(3);
    expect(nextRovingTabindex(1, 'ArrowLeft', -1)).toBe(1);
  });
});

describe('isCloseTabKey', () => {
  it('Delete と Backspace をタブを閉じるキーと判定する', () => {
    expect(isCloseTabKey('Delete')).toBe(true);
    expect(isCloseTabKey('Backspace')).toBe(true);
  });

  it('タブの移動キー・無関係なキーは閉じるキーと判定しない', () => {
    expect(isCloseTabKey('ArrowRight')).toBe(false);
    expect(isCloseTabKey('ArrowLeft')).toBe(false);
    expect(isCloseTabKey('Home')).toBe(false);
    expect(isCloseTabKey('End')).toBe(false);
    expect(isCloseTabKey('Tab')).toBe(false);
    expect(isCloseTabKey('Enter')).toBe(false);
    expect(isCloseTabKey(' ')).toBe(false);
    expect(isCloseTabKey('a')).toBe(false);
  });
});
