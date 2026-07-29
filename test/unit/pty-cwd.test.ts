// lsof の機械可読出力から cwd を取り出すパース（src/main/pty/cwd.ts）。
//
// `fcwd` の直後に来る `n` 行だけを採用する仕様が壊れると、実行中のシェルが
// 居るディレクトリではなく別の fd（実行ファイルのパスなど）を cwd として
// 誤扱いしてしまう。ここを固定する。

import { describe, expect, it } from 'vitest';
import { parseLsofCwd } from '../../src/main/pty/cwd';

describe('parseLsofCwd', () => {
  it('lsof -a -d cwd -p <pid> -Fn の出力そのまま（p / fcwd / n の3行）から cwd を取り出す', () => {
    const stdout = 'p12345\nfcwd\nn/Users/foo/work\n';
    expect(parseLsofCwd(stdout)).toBe('/Users/foo/work');
  });

  it('fcwd 以外のエントリに付いている n 行を誤って拾わない', () => {
    // 実行ファイル（ftxt）の n 行が fcwd より先に来る、実際に起こりうる並び。
    const stdout = ['p12345', 'ftxt', 'n/usr/bin/zsh', 'fcwd', 'n/Users/foo/work'].join('\n');
    expect(parseLsofCwd(stdout)).toBe('/Users/foo/work');
  });

  it('fcwd が無く別 fd の n 行しか無い場合は、その n 行を cwd として拾わない', () => {
    const stdout = ['p12345', 'ftxt', 'n/usr/bin/zsh'].join('\n');
    expect(parseLsofCwd(stdout)).toBeUndefined();
  });

  it('パスに空白や日本語が含まれていても壊れない', () => {
    const stdout = 'p12345\nfcwd\nn/Users/foo/日本語 プロジェクト\n';
    expect(parseLsofCwd(stdout)).toBe('/Users/foo/日本語 プロジェクト');
  });

  it('該当するエントリが無い出力では undefined を返す', () => {
    const stdout = 'p12345\n';
    expect(parseLsofCwd(stdout)).toBeUndefined();
  });

  it('空文字列では undefined を返す', () => {
    expect(parseLsofCwd('')).toBeUndefined();
  });

  it('fcwd の直後の n 行の中身が空の場合も undefined を返す', () => {
    const stdout = 'p12345\nfcwd\nn\n';
    expect(parseLsofCwd(stdout)).toBeUndefined();
  });
});
