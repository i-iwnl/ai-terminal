// PTY の起動コマンド組み立てと環境変数。
//
// `--session-id` を渡さないとタスク一覧との突き合わせができず、`--resume` の
// 引数を間違えると履歴からの再開が黙って新規セッションになる。
// どちらも画面上は「一応動いている」ように見えるため、ここで固定する。

import { describe, expect, it } from 'vitest';
import { buildPtyEnv, buildSpawnPlan, maybeWrapWithTmux } from '../../src/main/pty/manager';
import {
  buildTmuxEnvNames,
  buildTmuxSessionName,
  buildTmuxUpdateEnvironment,
  wrapCommandWithTmux,
} from '../../src/main/pty/tmux';

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

// tmux ラップ時の環境変数の転送（2026-08-06 / #180 周11）。
//
// **なぜ unit で固定するか。** E2E ハーネスは `useTmux: false` 固定なので、この分岐は
// E2E から踏めない。判定を純粋関数へ出して単体で固定するのがこのリポジトリの既定の作法
// （resizeGate / computeYourTurnSince / paneHeader 等と同じ形）。
//
// **何を守っているか。** tmux はサーバ起動時の env を凍結して子プロセスへ渡すため、
// node-pty に env を渡すだけでは AI ペインに1つも届かない。実際に `~/.zshrc` 由来の
// `GOOGLE_CLOUD_PROJECT` が落ち、Gemini タブが認証できなかった（実アプリで再現・
// 設定で tmux を切ると同じ env で認証が通る、という非対称で切り分けた）。
describe('tmux への環境変数の渡し方', () => {
  // ⛔ **この検査がこの周の本体。** 値を argv に載せると、node-pty が起動した
  // tmux クライアントがタブの生存中ずっとその argv を持ち、`ps -eo command` で
  // 同じマシンの誰からでも読める（2026-08-06 実測）。利用者の rc に書かれた
  // API キー等がそのまま載るため、**値は一度も argv を通してはいけない**。
  it('起動コマンドに環境変数の値を1つも載せない', () => {
    const wrapped = wrapCommandWithTmux('aiterm-abc', {
      command: 'gemini',
      args: ['--session-id', 'abc'],
    });
    expect(wrapped.args.join(' ')).not.toContain('=');
    expect(wrapped.args).toEqual([
      'new-session',
      '-A',
      '-s',
      'aiterm-abc',
      '--',
      'gemini',
      '--session-id',
      'abc',
    ]);
  });

  it('tmux へ渡すのは変数名だけで、値は含めない', () => {
    const names = buildTmuxEnvNames({
      GOOGLE_CLOUD_PROJECT: 'my-project',
      NOTION_API_KEY: 'secret-value',
    });
    expect(names).toEqual(['GOOGLE_CLOUD_PROJECT', 'NOTION_API_KEY']);
    expect(names.join(' ')).not.toContain('secret-value');
    expect(names.join(' ')).not.toContain('my-project');
  });

  it('TMUX / TMUX_PANE は持ち込まない（入れ子の tmux だと誤認させる）', () => {
    expect(buildTmuxEnvNames({ TMUX: '/tmp/x,1,0', TMUX_PANE: '%3', LANG: 'ja' })).toEqual(['LANG']);
  });

  it('値が undefined のキーは「設定しない」なので落とす', () => {
    expect(buildTmuxEnvNames({ LANG: undefined, TERM: 'xterm-256color' })).toEqual(['TERM']);
  });

  // tmux のオプション値は空白区切りなので、名前に空白や = が入ると並び全体が壊れる。
  it('空白や = を含むキーは落とす（オプション値の区切りを壊さない）', () => {
    expect(buildTmuxEnvNames({ 'A=B': 'c', 'X Y': 'z', OK: 'v' })).toEqual(['OK']);
  });

  it('キーの順序は安定している（辞書順）', () => {
    expect(buildTmuxEnvNames({ B: '2', A: '1', C: '3' })).toEqual(['A', 'B', 'C']);
  });

  // 利用者が自分で設定していることがある。こちらの都合で消してよいものではない。
  it('update-environment の既存の値を消さずに追記する', () => {
    expect(buildTmuxUpdateEnvironment(['DISPLAY', 'SSH_AUTH_SOCK'], ['LANG', 'TERM'])).toBe(
      'DISPLAY SSH_AUTH_SOCK LANG TERM',
    );
  });

  it('update-environment が重複しない', () => {
    expect(buildTmuxUpdateEnvironment(['DISPLAY', 'LANG'], ['LANG', 'TERM'])).toBe(
      'DISPLAY LANG TERM',
    );
  });

  it('update-environment は空要素を持ち込まない（show-options の空行対策）', () => {
    expect(buildTmuxUpdateEnvironment(['DISPLAY', '', '  '], ['LANG'])).toBe('DISPLAY LANG');
  });
});

describe('maybeWrapWithTmux（AI ペインだけを tmux でラップする）', () => {
  const plan = { command: 'gemini', args: ['--session-id', 'abc'] };
  const env = { GOOGLE_CLOUD_PROJECT: 'my-project' };

  it('AI ペインは tmux でラップされ、env の値は argv に載らない', () => {
    const result = maybeWrapWithTmux(
      { kind: 'gemini', cols: 80, rows: 24 },
      plan,
      { useTmux: true },
      'pty-1',
      env,
      true,
    );
    expect(result.wrappedInTmux).toBe(true);
    expect(result.plan.command).toBe('tmux');
    // ⛔ ps から読めるので、値は1つも載せない。
    expect(result.plan.args.join(' ')).not.toContain('my-project');
    expect(result.plan.args.join(' ')).not.toContain('GOOGLE_CLOUD_PROJECT');
  });

  it('tmux が使えないときは素の起動のままで、env をコマンドに混ぜない', () => {
    const result = maybeWrapWithTmux(
      { kind: 'gemini', cols: 80, rows: 24 },
      plan,
      { useTmux: true },
      'pty-1',
      env,
      false,
    );
    expect(result.wrappedInTmux).toBe(false);
    expect(result.plan).toEqual(plan);
  });

  it('シェルは tmux でラップしない（node-pty 経由で env が届く）', () => {
    const result = maybeWrapWithTmux(
      { kind: 'shell', cols: 80, rows: 24 },
      { command: '/bin/zsh', args: ['-l'] },
      { useTmux: true },
      'pty-1',
      env,
      true,
    );
    expect(result.wrappedInTmux).toBe(false);
    expect(result.plan.args).toEqual(['-l']);
  });
});
