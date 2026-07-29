// 起動時 cwd をホームへ倒すかどうかの判定（src/main/app-paths.ts）。
//
// Finder / Dock から起動すると process.cwd() が '/' になり、履歴ディレクトリ名は
// cwd の絶対パスから機械的に作られるため '/' のままでは履歴一覧が確実に空になる。
// '/' と空文字だけをホームへ倒し、通常のパスは上書きしないことを固定する。

import { describe, expect, it } from 'vitest';
import { resolveLaunchCwd } from '../../src/main/app-paths';

describe('resolveLaunchCwd', () => {
  it('/（Finder 起動）ではホームディレクトリを返す', () => {
    expect(resolveLaunchCwd('/', '/Users/demo')).toBe('/Users/demo');
  });

  it('空文字ではホームディレクトリを返す', () => {
    expect(resolveLaunchCwd('', '/Users/demo')).toBe('/Users/demo');
  });

  it('通常のパスはそのまま返す（ホームで上書きしない）', () => {
    expect(resolveLaunchCwd('/Users/demo/work/ai-terminal', '/Users/demo')).toBe(
      '/Users/demo/work/ai-terminal',
    );
  });

  it('/ で始まるだけの通常パスを誤ってホームへ倒さない', () => {
    // '/' そのものではなく '/Users/foo' のような通常パスは startsWith('/') だが対象外
    expect(resolveLaunchCwd('/Users/foo', '/Users/demo')).toBe('/Users/foo');
  });
});
