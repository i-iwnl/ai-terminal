// ドラッグ&ドロップされたパスの整形。
//
// **ここが間違うとシェルに意図しないコマンドが渡る。** 空白を含むパスがエスケープされなければ
// 2つの引数に割れ、`;` や `$` が素通しされれば別のコマンドが実行される。
// 画面を見ても気づけない（挿入された見た目は自然なまま）ので、境界をここで固定する。

import { describe, expect, it } from 'vitest';
import {
  escapeShellPath,
  buildDropInsertion,
  pathsFromUriList,
} from '../../src/renderer/src/lib/dropPath';

describe('escapeShellPath', () => {
  it('英数字と _ . / - だけのパスは何も足さない', () => {
    expect(escapeShellPath('/Users/me/work/demo-project/src/main.ts')).toBe(
      '/Users/me/work/demo-project/src/main.ts',
    );
  });

  it('空白をエスケープする', () => {
    expect(escapeShellPath('/Users/me/My Documents/a.txt')).toBe(
      '/Users/me/My\\ Documents/a.txt',
    );
  });

  it('シェルにとって意味のある記号をすべてエスケープする', () => {
    // 素通しすると別のコマンドが走る・変数が展開されるもの
    expect(escapeShellPath('/tmp/a;rm b')).toBe('/tmp/a\\;rm\\ b');
    expect(escapeShellPath('/tmp/$HOME')).toBe('/tmp/\\$HOME');
    expect(escapeShellPath('/tmp/a`b`')).toBe('/tmp/a\\`b\\`');
    expect(escapeShellPath('/tmp/a&b|c')).toBe('/tmp/a\\&b\\|c');
    expect(escapeShellPath("/tmp/it's")).toBe("/tmp/it\\'s");
    expect(escapeShellPath('/tmp/a"b')).toBe('/tmp/a\\"b');
    expect(escapeShellPath('/tmp/a*b?c[d]')).toBe('/tmp/a\\*b\\?c\\[d\\]');
    expect(escapeShellPath('/tmp/a\\b')).toBe('/tmp/a\\\\b');
    expect(escapeShellPath('/tmp/(a)')).toBe('/tmp/\\(a\\)');
  });

  it('日本語と絵文字はエスケープしない', () => {
    // シェルにとって特別な意味を持たない上、エスケープすると読めなくなる
    expect(escapeShellPath('/Users/me/資料/設計 メモ.md')).toBe(
      '/Users/me/資料/設計\\ メモ.md',
    );
    expect(escapeShellPath('/tmp/🐙.png')).toBe('/tmp/🐙.png');
  });

  it('改行を含むパスはクォートで囲む（バックスラッシュだと行継続になって改行が消える）', () => {
    expect(escapeShellPath('/tmp/a\nb')).toBe("'/tmp/a\nb'");
  });

  it('改行とシングルクォートが同居しても閉じ直す', () => {
    expect(escapeShellPath("/tmp/it's\nhere")).toBe("'/tmp/it'\\''s\nhere'");
  });

  it('空文字は空のトークンにする（無言で消さない）', () => {
    expect(escapeShellPath('')).toBe("''");
  });
});

describe('buildDropInsertion', () => {
  it('末尾にスペースを1つ足す（続けてフラグを打てるようにする）', () => {
    expect(buildDropInsertion(['/tmp/a.txt'])).toBe('/tmp/a.txt ');
  });

  it('複数件はスペース区切りで並べる', () => {
    expect(buildDropInsertion(['/tmp/a.txt', '/tmp/b c.txt'])).toBe(
      '/tmp/a.txt /tmp/b\\ c.txt ',
    );
  });

  it('空配列では何も挿入しない', () => {
    // PTY へ空白だけを送ってしまわないこと
    expect(buildDropInsertion([])).toBe('');
  });

  it('パスを取り出せなかった要素（空文字）は捨てる', () => {
    expect(buildDropInsertion(['', '/tmp/a.txt', ''])).toBe('/tmp/a.txt ');
  });
});

describe('pathsFromUriList', () => {
  it('file URI をデコードして絶対パスにする', () => {
    expect(pathsFromUriList('file:///Users/me/a%20b.txt')).toEqual(['/Users/me/a b.txt']);
  });

  it('複数行（CRLF 区切り）をすべて拾う', () => {
    expect(pathsFromUriList('file:///tmp/a.txt\r\nfile:///tmp/b.txt\r\n')).toEqual([
      '/tmp/a.txt',
      '/tmp/b.txt',
    ]);
  });

  it('RFC 2483 のコメント行と空行を無視する', () => {
    expect(pathsFromUriList('# comment\n\nfile:///tmp/a.txt\n')).toEqual(['/tmp/a.txt']);
  });

  it('file://localhost/ 形式も受ける', () => {
    expect(pathsFromUriList('file://localhost/tmp/a.txt')).toEqual(['/tmp/a.txt']);
  });

  it('日本語のパーセントエンコーディングを戻す', () => {
    expect(pathsFromUriList('file:///Users/me/%E8%B3%87%E6%96%99/a.txt')).toEqual([
      '/Users/me/資料/a.txt',
    ]);
  });

  it('file 以外のスキームは無視する', () => {
    // URL をドラッグしてきた場合にパスとして扱わない
    expect(pathsFromUriList('https://example.com/a.txt')).toEqual([]);
  });

  it('壊れた URI があっても他の行を取りこぼさない', () => {
    // 外部フォーマットのパース失敗でアプリを落とさない、の方針
    expect(pathsFromUriList('file:///tmp/%ZZ\nfile:///tmp/ok.txt')).toEqual(['/tmp/ok.txt']);
  });

  it('相対パスの file URI は捨てる', () => {
    expect(pathsFromUriList('file://relative/x')).toEqual([]);
  });
});
