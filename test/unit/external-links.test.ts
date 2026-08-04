// 既定ブラウザへ渡してよい URL かの判定（src/main/external-links.ts）。
//
// **なぜここで固定するのか。** 開いた先は本物のブラウザなので Playwright から
// 観測できない。E2E（S92）が見られるのは「`shell.openExternal` が呼ばれたか」
// までで、**どのスキームを弾くかの網羅はここにしか書けない**。
//
// **弾く理由はセキュリティ。** 渡ってくる URL は PTY 出力 = 外部由来で、
// `shell.openExternal` はブラウザ専用の API ではない。`file:` は Finder を、
// 独自スキームは登録済みの任意のアプリを起動できるので、allowlist で絞る
// （ルート CLAUDE.md の鉄則5「外から来る値は unknown で受けて絞り込む」の適用先）。

import { describe, expect, it } from 'vitest';
import { isSafeExternalUrl } from '../../src/main/external-links';

describe('isSafeExternalUrl', () => {
  it('http / https は開く（ターミナルに出る URL の大半）', () => {
    expect(isSafeExternalUrl('https://github.com/i-iwnl/ai-terminal/pull/1')).toBe(true);
    expect(isSafeExternalUrl('http://localhost:5173/')).toBe(true);
    // クエリ・フラグメント・ポート付きでも変わらない。
    expect(isSafeExternalUrl('https://example.com:8443/a/b?c=1#d')).toBe(true);
  });

  it('mailto は開く（エージェントの出力に現れうる）', () => {
    expect(isSafeExternalUrl('mailto:someone@example.com')).toBe(true);
  });

  it('file: は開かない（Finder が起動し、任意のパスを覗ける）', () => {
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeExternalUrl('file:///Users/demo/Library/Keychains')).toBe(false);
  });

  it('独自スキームは開かない（登録済みの任意のアプリを起動できてしまう）', () => {
    // macOS に実在する例。**端末に文字列を出せる側がアプリ起動をトリガできる**
    // 状態を作らないための門。
    expect(isSafeExternalUrl('vscode://file/Users/demo/secret')).toBe(false);
    expect(isSafeExternalUrl('x-apple.systempreferences:com.apple.preference')).toBe(false);
    expect(isSafeExternalUrl('itms-apps://apps.apple.com/app/id1')).toBe(false);
  });

  it('javascript: / data: は開かない', () => {
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('スキームの大文字小文字で判定が変わらない（URL が protocol を小文字に正規化する）', () => {
    expect(isSafeExternalUrl('HTTPS://example.com/')).toBe(true);
    expect(isSafeExternalUrl('FILE:///etc/passwd')).toBe(false);
  });

  it('URL として解釈できない文字列は開かない（例外で落ちない）', () => {
    expect(isSafeExternalUrl('')).toBe(false);
    expect(isSafeExternalUrl('   ')).toBe(false);
    expect(isSafeExternalUrl('example.com')).toBe(false);
    expect(isSafeExternalUrl('/Users/demo/notes.md')).toBe(false);
    expect(isSafeExternalUrl('about:blank')).toBe(false);
  });
});
