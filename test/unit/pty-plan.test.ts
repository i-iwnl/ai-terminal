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
  // Issue #155 で claude と対称にした。非対称の全文は src/main/pty/tmux.ts 冒頭が唯一の正。
  const SUPPORTED = { geminiSessionId: true };

  it('新規起動では採番した UUID を --session-id で渡す（claude と対称）', () => {
    const plan = buildSpawnPlan(
      { kind: 'gemini', cols: 80, rows: 24 },
      { shell: undefined },
      () => 'fixed-uuid',
      SUPPORTED,
    );
    expect(plan).toEqual({
      command: 'gemini',
      args: ['--session-id', 'fixed-uuid'],
      agentSessionId: 'fixed-uuid',
    });
  });

  it('再開は --resume に index を渡し、agentSessionId には履歴側の UUID が入る', () => {
    const plan = buildSpawnPlan(
      {
        kind: 'gemini',
        cols: 80,
        rows: 24,
        geminiResumeTarget: '1',
        geminiAgentSessionId: 'session-uuid',
      },
      { shell: undefined },
      () => 'should-not-be-used',
      SUPPORTED,
    );
    expect(plan.args).toEqual(['--resume', '1']);
    expect(plan.agentSessionId).toBe('session-uuid');
  });

  it('⛔ --resume に UUID を渡さない（数字始まりの UUID は index として解釈され、既存のセッションを失う）', () => {
    // 2026-08-06 実測 / Gemini CLI 0.53.0 / 2回再現。
    // 「効かない」のではなく「壊す」ので、args に UUID が出ないことを直接見る。
    const uuid = '12345678-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const plan = buildSpawnPlan(
      {
        kind: 'gemini',
        cols: 80,
        rows: 24,
        geminiResumeTarget: '2',
        geminiAgentSessionId: uuid,
      },
      { shell: undefined },
      undefined,
      SUPPORTED,
    );
    expect(plan.args).not.toContain(uuid);
    expect(plan.args).toEqual(['--resume', '2']);
  });

  it('新規起動と、その ID からの再開で tmux セッション名が一致する（claude 側と対称）', () => {
    const freshPlan = buildSpawnPlan(
      { kind: 'gemini', cols: 80, rows: 24 },
      { shell: undefined },
      () => 'gemini-session-x',
      SUPPORTED,
    );
    const resumePlan = buildSpawnPlan(
      {
        kind: 'gemini',
        cols: 80,
        rows: 24,
        geminiResumeTarget: '1',
        geminiAgentSessionId: freshPlan.agentSessionId,
      },
      { shell: undefined },
      undefined,
      SUPPORTED,
    );
    expect(buildTmuxSessionName(freshPlan.agentSessionId!)).toBe(
      buildTmuxSessionName(resumePlan.agentSessionId!),
    );
  });

  it('起動ごとに別の UUID を採番する（別セッションの tmux 名が衝突しない）', () => {
    let n = 0;
    const gen = (): string => `gemini-session-${++n}`;
    const plan1 = buildSpawnPlan({ kind: 'gemini', cols: 80, rows: 24 }, { shell: undefined }, gen, SUPPORTED);
    const plan2 = buildSpawnPlan({ kind: 'gemini', cols: 80, rows: 24 }, { shell: undefined }, gen, SUPPORTED);
    expect(buildTmuxSessionName(plan1.agentSessionId!)).not.toBe(
      buildTmuxSessionName(plan2.agentSessionId!),
    );
  });

  it('⚠ CLI が --session-id に対応していなければ渡さず、agentSessionId も返さない（縮退）', () => {
    // 未知のフラグを渡された gemini は usage を出して即終了する（2026-08-06 実測）。
    // tmux ラップ下では「開いた瞬間に終了したペイン」にしか見えないので、
    // 対応が確認できないときは従来どおり引数なしで起動する。
    const plan = buildSpawnPlan(
      { kind: 'gemini', cols: 80, rows: 24 },
      { shell: undefined },
      () => 'unused-uuid',
      { geminiSessionId: false },
    );
    expect(plan).toEqual({ command: 'gemini', args: [] });
  });

  it('⛔ 対応状況を渡し忘れたら「非対応」に倒れる（既定値の向きを固定する）', () => {
    // 渡し忘れて --session-id が付くほうへ倒れると、古い CLI の利用者の
    // 新規タブが起動直後に死ぬ。倒れる先は常に従来の挙動側。
    const plan = buildSpawnPlan({ kind: 'gemini', cols: 80, rows: 24 }, { shell: undefined });
    expect(plan.args).toEqual([]);
    expect(plan.agentSessionId).toBeUndefined();
  });

  it('resume 元の UUID が取れなければ agentSessionId は undefined（縮退。回収できない側に分類される）', () => {
    const plan = buildSpawnPlan(
      { kind: 'gemini', cols: 80, rows: 24, geminiResumeTarget: 'latest' },
      { shell: undefined },
      undefined,
      SUPPORTED,
    );
    expect(plan.args).toEqual(['--resume', 'latest']);
    expect(plan.agentSessionId).toBeUndefined();
  });
});

describe('buildPtyEnv', () => {
  it('ELECTRON_ 系の環境変数を落とす', () => {
    // Electron が注入する変数をそのまま子プロセスへ渡すと、
    // 子側の Node/Electron が誤動作する
    const env = buildPtyEnv(
      {
        ELECTRON_RUN_AS_NODE: '1',
        ELECTRON_RENDERER_URL: 'http://localhost:5173',
        PATH: '/usr/bin',
      },
      '1.2.3',
    );
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(env.ELECTRON_RENDERER_URL).toBeUndefined();
    expect(env.PATH).toBe('/usr/bin');
  });

  it('色が出るよう TERM と COLORTERM を設定する', () => {
    const env = buildPtyEnv({}, '1.2.3');
    expect(env.TERM).toBe('xterm-256color');
    expect(env.COLORTERM).toBe('truecolor');
  });

  it('LANG が未設定なら日本語ロケールを補い、設定済みなら尊重する', () => {
    expect(buildPtyEnv({}, '1.2.3').LANG).toBe('ja_JP.UTF-8');
    expect(buildPtyEnv({ LANG: 'en_US.UTF-8' }, '1.2.3').LANG).toBe('en_US.UTF-8');
  });

  it('渡された環境を書き換えない', () => {
    const base = { ELECTRON_RUN_AS_NODE: '1' };
    buildPtyEnv(base, '1.2.3');
    expect(base.ELECTRON_RUN_AS_NODE).toBe('1');
  });

  // Issue #61: ターミナルから `make dev` 等で起動すると、起動元の TERM_PROGRAM
  // （例: Apple_Terminal）がそのまま子プロセスへ継承され、macOS の
  // /etc/zshrc_Apple_Terminal がセッション復元を走らせて「Restored session: ...」
  // という嘘の行が出る（何も復元していない）。何を継承しても ai-terminal に
  // 固定することで、この因果を断つ。
  it('TERM_PROGRAM が Apple_Terminal を継承していても ai-terminal に上書きする', () => {
    const env = buildPtyEnv({ TERM_PROGRAM: 'Apple_Terminal' }, '1.2.3');
    expect(env.TERM_PROGRAM).toBe('ai-terminal');
  });

  it('TERM_PROGRAM が iTerm.app を継承していても ai-terminal に上書きする', () => {
    const env = buildPtyEnv({ TERM_PROGRAM: 'iTerm.app' }, '1.2.3');
    expect(env.TERM_PROGRAM).toBe('ai-terminal');
  });

  it('TERM_PROGRAM が未設定でも ai-terminal になる', () => {
    const env = buildPtyEnv({}, '1.2.3');
    expect(env.TERM_PROGRAM).toBe('ai-terminal');
  });

  // TERM_PROGRAM_VERSION は TERM_PROGRAM とセットで意味を持つ値。TERM_PROGRAM だけ
  // 上書きして VERSION を素通しすると「ai-terminal なのにバージョンは Apple Terminal
  // のもの」という不整合な組み合わせが残る。ai-terminal 自身のバージョンに揃える。
  it('TERM_PROGRAM_VERSION は継承した値を無視し、引数で渡したアプリのバージョンになる', () => {
    const env = buildPtyEnv({ TERM_PROGRAM_VERSION: '470.2' }, '0.0.1');
    expect(env.TERM_PROGRAM_VERSION).toBe('0.0.1');
  });
});
