// データ保存先の決定規則（src/main/data-dir.ts）。
//
// dev と安定版の保存先が分かれること・E2E の環境変数上書きが最優先で効くことは、
// 壊れると「設定が消えた」ように見える不具合になるため、規則そのものを固定する。

import { describe, expect, it } from 'vitest';
import { resolveDataDir } from '../../src/main/data-dir';

describe('resolveDataDir', () => {
  it('パッケージ版は ~/.ai-terminal を使う（既存データを引き継ぐ側）', () => {
    expect(
      resolveDataDir({ isPackaged: true, envOverride: undefined, home: '/Users/demo' }),
    ).toBe('/Users/demo/.ai-terminal');
  });

  it('非パッケージ（make dev / E2E）は -dev サフィックスへ分離する', () => {
    expect(
      resolveDataDir({ isPackaged: false, envOverride: undefined, home: '/Users/demo' }),
    ).toBe('/Users/demo/.ai-terminal-dev');
  });

  it('AI_TERMINAL_DATA_DIR の絶対パス指定が isPackaged より優先される', () => {
    expect(
      resolveDataDir({
        isPackaged: false,
        envOverride: '/tmp/e2e-home/.ai-terminal',
        home: '/Users/demo',
      }),
    ).toBe('/tmp/e2e-home/.ai-terminal');
  });

  it('空文字の環境変数は未指定として扱う（シェルの空 export で保存先が壊れない）', () => {
    expect(
      resolveDataDir({ isPackaged: true, envOverride: '', home: '/Users/demo' }),
    ).toBe('/Users/demo/.ai-terminal');
  });
});
