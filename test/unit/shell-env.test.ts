// ログインシェルから env を取り直す処理（#180 周11 / 2026-08-06）。
//
// **何を守っているか。** macOS の GUI アプリは launchd 起動なので `~/.zshrc` の
// 値を1つも持たない。素で spawn される AI ペイン（claude / gemini）だけが
// その影響を受け、`GOOGLE_CLOUD_PROJECT` が無くて Gemini CLI が認証できない、
// という形で出る（PATH については測っていないので何も主張しない。shellEnv.ts 冒頭）。
//
// spawn そのものはユーザーの rc を実行するので単体で回せない。
// **解釈とマージだけを純粋関数へ出して固定する**（このリポジトリの既定の作法）。

import { describe, expect, it } from 'vitest';
import { mergeUserEnv, parseShellEnvOutput } from '../../src/main/pty/shellEnv';

describe('parseShellEnvOutput', () => {
  it('目印のあとの NUL 区切りレコードを解釈する', () => {
    const out = '__AITERM_ENV__PATH=/usr/bin\0GOOGLE_CLOUD_PROJECT=my-project\0';
    expect(parseShellEnvOutput(out)).toEqual({
      PATH: '/usr/bin',
      GOOGLE_CLOUD_PROJECT: 'my-project',
    });
  });

  // 対話シェルは rc の中で何かを表示することがある。目印より前は捨てる。
  it('目印より前に rc の出力が混ざっていても捨てる', () => {
    const out = 'Welcome!\nnvm loaded\n__AITERM_ENV__PATH=/usr/bin\0';
    expect(parseShellEnvOutput(out)).toEqual({ PATH: '/usr/bin' });
  });

  // 取れなかったときに推測で埋めない（縮退して現状維持にする）。
  it('目印が無ければ空を返す', () => {
    expect(parseShellEnvOutput('PATH=/usr/bin\0')).toEqual({});
    expect(parseShellEnvOutput('')).toEqual({});
  });

  it('値に = が含まれていても最初の = で分ける', () => {
    const out = '__AITERM_ENV__LS_COLORS=di=1;34:ln=35\0';
    expect(parseShellEnvOutput(out)).toEqual({ LS_COLORS: 'di=1;34:ln=35' });
  });

  it('値が空のレコードも保つ（未設定とは違う）', () => {
    expect(parseShellEnvOutput('__AITERM_ENV__EMPTY=\0')).toEqual({ EMPTY: '' });
  });

  it('= を含まない行や = で始まる行は無視する（rc の出力が紛れ込んだ場合）', () => {
    const out = '__AITERM_ENV__これはノイズ\0=value\0OK=1\0';
    expect(parseShellEnvOutput(out)).toEqual({ OK: '1' });
  });

  it('複数行にまたがる値を保つ', () => {
    const out = '__AITERM_ENV__MULTI=line1\nline2\0OK=1\0';
    expect(parseShellEnvOutput(out)).toEqual({ MULTI: 'line1\nline2', OK: '1' });
  });
});

describe('mergeUserEnv', () => {
  // ⛔ **この向きを逆にしない。** 起動元が明示的に渡した env は常にそちらが意図で、
  // E2E ハーネスの一時 HOME / 偽 CLI を先頭に置いた PATH のように「意図的に絞った env」を
  // rc 由来の値で崩さないため。shell-path.ts の mergePathEntries と同じ結論。
  // ⚠ 一度これを「make e2e の S56 が落ちたのが根拠」と書いたが誤り（S56 は既知の flaky）。
  it('起動元が明示的に渡したキーは上書きしない（E2E の一時 HOME / 偽 CLI の PATH を守る）', () => {
    const merged = mergeUserEnv(
      { HOME: '/tmp/e2e-home', PATH: '/tmp/fixtures/bin:/usr/bin' },
      { HOME: '/Users/real', PATH: '/opt/homebrew/bin:/usr/bin' },
    );
    expect(merged.HOME).toBe('/tmp/e2e-home');
    expect(merged.PATH).toBe('/tmp/fixtures/bin:/usr/bin');
  });

  // これが本題。GUI 起動の .app に無い変数だけを補う。
  it('起動元に無いキーだけを埋める（GUI 起動で ~/.zshrc の値が1つも無い状態を補う）', () => {
    const merged = mergeUserEnv({ PATH: '/usr/bin' }, { GOOGLE_CLOUD_PROJECT: 'my-project' });
    expect(merged.GOOGLE_CLOUD_PROJECT).toBe('my-project');
    expect(merged.PATH).toBe('/usr/bin');
  });

  it('起動元にしか無いキーは残る', () => {
    const merged = mergeUserEnv({ AI_TERMINAL_DATA_DIR: '/tmp/x' }, { PATH: '/usr/bin' });
    expect(merged.AI_TERMINAL_DATA_DIR).toBe('/tmp/x');
    expect(merged.PATH).toBe('/usr/bin');
  });

  // 空文字は「設定されている」。埋め直すと起動元の意図を壊す。
  it('起動元の値が空文字でも上書きしない', () => {
    expect(mergeUserEnv({ FOO: '' }, { FOO: 'bar' }).FOO).toBe('');
  });

  // 使い捨てシェルの状態であって、ユーザーの環境ではない。
  it('プローブ用シェルの状態は、起動元に無くても持ち込まない', () => {
    const merged = mergeUserEnv(
      {},
      { SHLVL: '5', PWD: '/tmp', OLDPWD: '/x', _: '/usr/bin/env', TMUX: '/tmp/s,1,0', LANG: 'ja' },
    );
    expect(merged.SHLVL).toBeUndefined();
    expect(merged.PWD).toBeUndefined();
    expect(merged.OLDPWD).toBeUndefined();
    expect(merged._).toBeUndefined();
    expect(merged.TMUX).toBeUndefined();
    expect(merged.LANG).toBe('ja');
  });

  it('解決できなかった（空）ときは起動元をそのまま返す', () => {
    const base = { PATH: '/usr/bin', FOO: 'bar' };
    expect(mergeUserEnv(base, {})).toEqual(base);
  });

  it('起動元を書き換えない（新しいオブジェクトを返す）', () => {
    const base = { PATH: '/usr/bin' };
    mergeUserEnv(base, { PATH: '/opt/bin' });
    expect(base.PATH).toBe('/usr/bin');
  });
});
