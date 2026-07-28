// 設定ファイル（~/.ai-terminal/config.json）の正規化。
//
// このアプリは「設定ファイルが壊れていても落ちない」ことを設計方針にしている。
// その方針が実際に守られているかを、壊れた入力を食わせて確認する。

import { describe, expect, it } from 'vitest';
import { coerceConfig, DEFAULT_CONFIG } from '../../src/main/config';

describe('coerceConfig', () => {
  it('オブジェクトでない入力は既定値へ縮退する', () => {
    expect(coerceConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(coerceConfig('壊れた設定')).toEqual(DEFAULT_CONFIG);
    expect(coerceConfig(42)).toEqual(DEFAULT_CONFIG);
    expect(coerceConfig(undefined)).toEqual(DEFAULT_CONFIG);
  });

  it('型が合わないフィールドだけを捨て、正しいフィールドは残す', () => {
    const result = coerceConfig({
      fontFamily: 'Monaco',
      fontSize: 'おおきく', // 数値でない
      notifyOnIdle: 'yes', // 真偽値でない
    });
    expect(result.fontFamily).toBe('Monaco');
    expect(result.fontSize).toBe(DEFAULT_CONFIG.fontSize);
    expect(result.notifyOnIdle).toBe(DEFAULT_CONFIG.notifyOnIdle);
  });

  it('フォントサイズを 6〜48 に収める', () => {
    expect(coerceConfig({ fontSize: 1 }).fontSize).toBe(6);
    expect(coerceConfig({ fontSize: 999 }).fontSize).toBe(48);
    expect(coerceConfig({ fontSize: 20 }).fontSize).toBe(20);
  });

  it('ポーリング間隔の下限を 500ms にする', () => {
    // 0 を許すとポーリングが暴走して claude agents --json を叩き続ける
    expect(coerceConfig({ pollIntervalMs: 0 }).pollIntervalMs).toBe(500);
    expect(coerceConfig({ pollIntervalMs: 5000 }).pollIntervalMs).toBe(5000);
  });

  it('NaN や Infinity は数値として受け付けない', () => {
    expect(coerceConfig({ fontSize: Number.NaN }).fontSize).toBe(DEFAULT_CONFIG.fontSize);
    expect(coerceConfig({ pollIntervalMs: Number.POSITIVE_INFINITY }).pollIntervalMs).toBe(
      DEFAULT_CONFIG.pollIntervalMs,
    );
  });

  it('theme が一部だけ壊れていても、壊れたキーだけ既定値になる', () => {
    const result = coerceConfig({ theme: { background: '#000000', foreground: 123 } });
    expect(result.theme.background).toBe('#000000');
    expect(result.theme.foreground).toBe(DEFAULT_CONFIG.theme.foreground);
  });

  it('webhook 設定が丸ごと無い古い設定ファイルでも既定値へ寄る', () => {
    // 通知機能を足す前に書かれた config.json を読んだ場合
    const result = coerceConfig({ fontSize: 14 });
    expect(result.slack).toEqual({ enabled: false, url: '' });
    expect(result.discord).toEqual({ enabled: false, url: '' });
    expect(result.notifySoundId).toBe('');
  });

  it('webhook 設定を読み取り、片方だけ壊れていても他方は残す', () => {
    const result = coerceConfig({
      slack: { enabled: true, url: 'https://hooks.slack.com/services/x' },
      discord: { enabled: 'true', url: 42 }, // 両方とも型が違う
    });
    expect(result.slack).toEqual({ enabled: true, url: 'https://hooks.slack.com/services/x' });
    expect(result.discord).toEqual({ enabled: false, url: '' });
  });

  it('shell は文字列のときだけ採用し、それ以外は undefined にする', () => {
    // undefined のとき pty 側が $SHELL -> /bin/zsh の順で解決する
    expect(coerceConfig({ shell: '/bin/bash' }).shell).toBe('/bin/bash');
    expect(coerceConfig({ shell: 123 }).shell).toBeUndefined();
    expect(coerceConfig({}).shell).toBeUndefined();
  });
});
