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

  it('gemini には安定したセッション名を付けない（agentSessionId は常に undefined）', () => {
    // ⚠ **理由は「ID を採番できないから」ではない**（Issue #155 / 2026-08-06 実測）。
    // Gemini CLI 0.53.0 には `--session-id <UUID>` があり、渡した UUID はそのまま
    // `--list-sessions` 行末の [UUID] に出る。それでも採番しないのは、**閉じたあとに
    // 選び直す側が成立しない**ため:
    //   (1) `gemini --list-sessions` は走行中のセッションを一覧に出さない
    //       （tmux で生き残らせた gemini はまさに走行中なので、履歴から選べない）
    //   (2) `--list-sessions` の実行自体が走行中セッションの JSONL を削除する
    // 安定名だけ付けても拾い直せず、「回収できる」という嘘の状態表現を生むだけになる。
    // 理由の全文は tmux.ts 冒頭コメント、再現手順は
    // .claude/workspace/issue-180/known-issues.md の 12番。
    //
    // ⛔ このテストを「反転させれば #155 が終わる」と読まないこと。反転させるには
    // 上の (1)(2) が解消しているかを実測し直すのが先。
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
