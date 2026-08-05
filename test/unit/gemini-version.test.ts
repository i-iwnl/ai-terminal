// Gemini CLI のバージョン判定（src/main/pty/geminiVersion.ts）。
//
// `--session-id` は 0.53.0 で確認したフラグで、それ未満に渡すと gemini は
// usage を出して即終了する（= 開いた瞬間に死んだペインになる）。
// 判定を間違えたときの被害が**非対称**なので、その非対称さをここで固定する。

import { describe, it, expect } from 'vitest';

import { parseGeminiVersion, supportsGeminiSessionId } from '../../src/main/pty/geminiVersion';

describe('parseGeminiVersion', () => {
  it('本物の出力（改行つきの版番号だけ）から取れる', () => {
    expect(parseGeminiVersion('0.53.0\n')).toEqual({ major: 0, minor: 53, patch: 0 });
  });

  it('接尾辞が付いていても取れる（E2E の偽 CLI は 0.53.0-e2e-fake を返す）', () => {
    expect(parseGeminiVersion('0.53.0-e2e-fake\n')).toEqual({ major: 0, minor: 53, patch: 0 });
  });

  it('版番号が見つからなければ undefined', () => {
    expect(parseGeminiVersion('command not found')).toBeUndefined();
    expect(parseGeminiVersion('')).toBeUndefined();
  });
});

describe('supportsGeminiSessionId', () => {
  it('0.53.0 ちょうどで対応とみなす（実測した版）', () => {
    expect(supportsGeminiSessionId('0.53.0')).toBe(true);
  });

  it('それより新しければ対応', () => {
    expect(supportsGeminiSessionId('0.53.1')).toBe(true);
    expect(supportsGeminiSessionId('0.54.0')).toBe(true);
    expect(supportsGeminiSessionId('1.0.0')).toBe(true);
  });

  it('それより古ければ非対応', () => {
    expect(supportsGeminiSessionId('0.52.9')).toBe(false);
    expect(supportsGeminiSessionId('0.37.0')).toBe(false);
    expect(supportsGeminiSessionId('0.9.0')).toBe(false);
  });

  it('⛔ 版が読み取れなければ非対応に倒す（安全側は常に false）', () => {
    // 外し方が非対称。渡さない側に外れて起きるのは「tmux セッション名が安定しない」=
    // 従来の挙動で、失うものが無い。渡す側に外れると新規タブが起動直後に死ぬ。
    expect(supportsGeminiSessionId('command not found')).toBe(false);
    expect(supportsGeminiSessionId('')).toBe(false);
  });

  it('メジャー版の比較がマイナー版より優先される', () => {
    // 「0.99.0 より 1.0.0 のほうが新しい」を桁ごとの比較で誤らないこと。
    expect(supportsGeminiSessionId('1.0.0')).toBe(true);
    expect(supportsGeminiSessionId('0.99.0')).toBe(true);
  });
});
