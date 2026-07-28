// PTY の起動コマンド組み立てと環境変数。
//
// `--session-id` を渡さないとタスク一覧との突き合わせができず、`--resume` の
// 引数を間違えると履歴からの再開が黙って新規セッションになる。
// どちらも画面上は「一応動いている」ように見えるため、ここで固定する。

import { describe, expect, it } from 'vitest';
import { buildPtyEnv, buildSpawnPlan } from '../../src/main/pty/manager';

describe('buildSpawnPlan（shell）', () => {
  it('設定のシェルをログインシェルとして起動する', () => {
    const plan = buildSpawnPlan({ kind: 'shell', cols: 80, rows: 24 }, { shell: '/bin/bash' });
    expect(plan).toEqual({ command: '/bin/bash', args: ['-l'] });
  });

  it('設定が空なら $SHELL にフォールバックする', () => {
    const plan = buildSpawnPlan({ kind: 'shell', cols: 80, rows: 24 }, { shell: undefined });
    expect(plan.command).toBe(process.env.SHELL || '/bin/zsh');
    expect(plan.args).toEqual(['-l']);
  });
});

describe('buildSpawnPlan（claude）', () => {
  it('新規起動では採番した UUID を --session-id で渡す', () => {
    const plan = buildSpawnPlan(
      { kind: 'claude', cols: 80, rows: 24 },
      { shell: undefined },
      () => 'fixed-uuid',
    );
    expect(plan.command).toBe('claude');
    expect(plan.args).toEqual(['--session-id', 'fixed-uuid']);
    // 一覧との突き合わせに使うので、採番した ID を呼び出し側へ返すこと
    expect(plan.agentSessionId).toBe('fixed-uuid');
  });

  it('再開では --resume を使い、新しい ID を採番しない', () => {
    const plan = buildSpawnPlan(
      { kind: 'claude', cols: 80, rows: 24, resumeSessionId: 'existing-id' },
      { shell: undefined },
      () => 'should-not-be-used',
    );
    expect(plan.args).toEqual(['--resume', 'existing-id']);
    expect(plan.agentSessionId).toBeUndefined();
  });
});

describe('buildSpawnPlan（gemini）', () => {
  it('新規起動は引数なし', () => {
    const plan = buildSpawnPlan({ kind: 'gemini', cols: 80, rows: 24 }, { shell: undefined });
    expect(plan).toEqual({ command: 'gemini', args: [] });
  });

  it('再開は --resume に指定された対象を渡す', () => {
    const plan = buildSpawnPlan(
      { kind: 'gemini', cols: 80, rows: 24, geminiResumeTarget: 'latest' },
      { shell: undefined },
    );
    expect(plan.args).toEqual(['--resume', 'latest']);
  });
});

describe('buildPtyEnv', () => {
  it('ELECTRON_ 系の環境変数を落とす', () => {
    // Electron が注入する変数をそのまま子プロセスへ渡すと、
    // 子側の Node/Electron が誤動作する
    const env = buildPtyEnv({
      ELECTRON_RUN_AS_NODE: '1',
      ELECTRON_RENDERER_URL: 'http://localhost:5173',
      PATH: '/usr/bin',
    });
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(env.ELECTRON_RENDERER_URL).toBeUndefined();
    expect(env.PATH).toBe('/usr/bin');
  });

  it('色が出るよう TERM と COLORTERM を設定する', () => {
    const env = buildPtyEnv({});
    expect(env.TERM).toBe('xterm-256color');
    expect(env.COLORTERM).toBe('truecolor');
  });

  it('LANG が未設定なら日本語ロケールを補い、設定済みなら尊重する', () => {
    expect(buildPtyEnv({}).LANG).toBe('ja_JP.UTF-8');
    expect(buildPtyEnv({ LANG: 'en_US.UTF-8' }).LANG).toBe('en_US.UTF-8');
  });

  it('渡された環境を書き換えない', () => {
    const base = { ELECTRON_RUN_AS_NODE: '1' };
    buildPtyEnv(base);
    expect(base.ELECTRON_RUN_AS_NODE).toBe('1');
  });
});
