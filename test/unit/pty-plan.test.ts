// PTY の起動コマンド組み立てと環境変数。
//
// `--session-id` を渡さないとタスク一覧との突き合わせができず、`--resume` の
// 引数を間違えると履歴からの再開が黙って新規セッションになる。
// どちらも画面上は「一応動いている」ように見えるため、ここで固定する。

import { describe, expect, it } from 'vitest';
import { buildPtyEnv, buildSpawnPlan } from '../../src/main/pty/manager';
import { buildTmuxSessionName } from '../../src/main/pty/tmux';

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
    // 採番はしないが、tmux セッション名を安定させるため resume 先の ID をそのまま返す
    expect(plan.agentSessionId).toBe('existing-id');
  });
});

describe('buildSpawnPlan（claude）と tmux セッション名の安定性', () => {
  // Issue #60: Cmd+W でタブを閉じても、tmux セッション名が resume のたびに変われば
  // 二度と同じセッションに戻れない。ここでは buildSpawnPlan の結果を実際に
  // buildTmuxSessionName に通し、名前が安定していることを担保する。

  it('同じセッションを2回 resume すると、tmux セッション名が2回とも同じになる', () => {
    const req = { kind: 'claude' as const, cols: 80, rows: 24, resumeSessionId: 'session-a' };
    const plan1 = buildSpawnPlan(req, { shell: undefined });
    const plan2 = buildSpawnPlan(req, { shell: undefined });
    expect(plan1.agentSessionId).toBe('session-a');
    expect(plan2.agentSessionId).toBe('session-a');
    expect(buildTmuxSessionName(plan1.agentSessionId!)).toBe(
      buildTmuxSessionName(plan2.agentSessionId!),
    );
  });

  it('新規起動を2回行うと、tmux セッション名は互いに異なる（衝突しない）', () => {
    let counter = 0;
    const generateId = (): string => `uuid-${counter++}`;
    const plan1 = buildSpawnPlan(
      { kind: 'claude', cols: 80, rows: 24 },
      { shell: undefined },
      generateId,
    );
    const plan2 = buildSpawnPlan(
      { kind: 'claude', cols: 80, rows: 24 },
      { shell: undefined },
      generateId,
    );
    expect(buildTmuxSessionName(plan1.agentSessionId!)).not.toBe(
      buildTmuxSessionName(plan2.agentSessionId!),
    );
  });

  it('新規起動で採番した ID と、その ID で resume したときの tmux セッション名が一致する（Cmd+W で閉じたタブに履歴から戻れる）', () => {
    const freshPlan = buildSpawnPlan(
      { kind: 'claude', cols: 80, rows: 24 },
      { shell: undefined },
      () => 'fixed-uuid',
    );
    const resumePlan = buildSpawnPlan(
      { kind: 'claude', cols: 80, rows: 24, resumeSessionId: freshPlan.agentSessionId },
      { shell: undefined },
    );
    expect(buildTmuxSessionName(freshPlan.agentSessionId!)).toBe(
      buildTmuxSessionName(resumePlan.agentSessionId!),
    );
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

  it('gemini は安定したセッション名を持たない（agentSessionId は常に undefined）', () => {
    // gemini には claude の --session-id / --resume <uuid> に相当する安定した ID が無い。
    // そのため tmux セッション名は ptyId（起動のたびに使い捨て）に頼るしかなく、
    // Cmd+W で閉じたタブには拾い直せない（Issue #60 の対象外。tmux.ts 冒頭コメント参照）。
    const newPlan = buildSpawnPlan({ kind: 'gemini', cols: 80, rows: 24 }, { shell: undefined });
    expect(newPlan.agentSessionId).toBeUndefined();

    const resumePlan = buildSpawnPlan(
      { kind: 'gemini', cols: 80, rows: 24, geminiResumeTarget: 'latest' },
      { shell: undefined },
    );
    expect(resumePlan.agentSessionId).toBeUndefined();
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
