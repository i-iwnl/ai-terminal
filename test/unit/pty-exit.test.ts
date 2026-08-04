// src/shared/pty-exit.ts の単体テスト（Issue #133）。
//
// **`dock.bounce()` の呼び出し自体は Playwright から観測できない**
// （Electron に Dock の状態を読み戻す API が無い）。だから判定を純粋関数に
// 切り出して、ここで固定する。このリポジトリの既定の作法
// （`resizeGate` / `computeYourTurnSince` / `closeTabCopy` / `paneHeader` と同じ形）。
//
// **「異常終了か」の正が2つにならないこと**もここが担保する。
// 同じ判定を Renderer の `severityForExit`（通知バナーの色）も見ている。

import { describe, expect, it } from 'vitest';
import { isAbnormalExit, shouldBounceOnExit } from '../../src/shared/pty-exit';
import { severityForExit } from '../../src/renderer/src/lib/notices';

describe('isAbnormalExit', () => {
  it('exitCode 0 かつシグナル無しは正常', () => {
    expect(isAbnormalExit({ exitCode: 0 })).toBe(false);
  });

  it('exitCode が 0 以外なら異常', () => {
    expect(isAbnormalExit({ exitCode: 1 })).toBe(true);
    expect(isAbnormalExit({ exitCode: 7 })).toBe(true);
    expect(isAbnormalExit({ exitCode: 127 })).toBe(true);
  });

  it('シグナルで終了したなら、exitCode が 0 でも異常', () => {
    expect(isAbnormalExit({ exitCode: 0, signal: 9 })).toBe(true);
    expect(isAbnormalExit({ exitCode: 0, signal: 15 })).toBe(true);
  });

  it('**signal: 0 は「シグナル無し」として扱う**（node-pty はこの形で届けることがある）', () => {
    // ここを truthy 判定にすると `signal: 0` が異常扱いになり、
    // **正常終了のたびに Dock が鳴る**。
    expect(isAbnormalExit({ exitCode: 0, signal: 0 })).toBe(false);
  });
});

describe('shouldBounceOnExit', () => {
  it('異常終了 かつ ウィンドウが前に無い -> 鳴らす', () => {
    expect(shouldBounceOnExit({ exitCode: 1 }, false)).toBe(true);
    expect(shouldBounceOnExit({ exitCode: 0, signal: 9 }, false)).toBe(true);
  });

  it('**正常終了では鳴らさない**（`zsh` に exit と打った自分に通知を返さない）', () => {
    expect(shouldBounceOnExit({ exitCode: 0 }, false)).toBe(false);
    expect(shouldBounceOnExit({ exitCode: 0, signal: 0 }, false)).toBe(false);
  });

  it('**ウィンドウを見ている最中は鳴らさない**（うるさいだけ）', () => {
    expect(shouldBounceOnExit({ exitCode: 1 }, true)).toBe(false);
    expect(shouldBounceOnExit({ exitCode: 0, signal: 9 }, true)).toBe(false);
  });

  it('2つの条件は AND（どちらか片方では鳴らない）', () => {
    // 表にして、4通りすべてを1本で押さえる。
    const cases: Array<[number, boolean, boolean]> = [
      // exitCode, windowFocused, 期待
      [0, true, false],
      [0, false, false],
      [1, true, false],
      [1, false, true],
    ];
    for (const [exitCode, focused, expected] of cases) {
      expect(shouldBounceOnExit({ exitCode }, focused), `exitCode=${exitCode} focused=${focused}`).toBe(
        expected,
      );
    }
  });
});

describe('Renderer の severityForExit と同じ判定を見ている（正が2つにならない）', () => {
  // **これが無いと、片方だけ直したときに「バナーはエラーなのに Dock は鳴らない」
  // という食い違いが静かに入る。** 両者は表現が違うだけで、事実は1つ。
  const events = [
    { exitCode: 0 },
    { exitCode: 0, signal: 0 },
    { exitCode: 0, signal: 9 },
    { exitCode: 1 },
    { exitCode: 7, signal: 15 },
  ];

  it('severityForExit が error を返す条件と、isAbnormalExit が true を返す条件が一致する', () => {
    for (const event of events) {
      expect(severityForExit(event) === 'error', JSON.stringify(event)).toBe(isAbnormalExit(event));
    }
  });
});
