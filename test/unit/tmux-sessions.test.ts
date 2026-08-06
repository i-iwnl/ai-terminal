// 生きている tmux セッションの一覧（#180 周12 / 2026-08-06）。
//
// **何を守っているか。** タスク一覧の行は「そのセッションを開いているタブがある」
// ときしか押せなかった。タブの構成はどこにも永続化していないので、**アプリを再起動した
// 瞬間、走っているセッションは全部「一覧には出るが押せない行」になっていた。**
//
// tmux を叩く側は単体で回せないので、**接頭辞の剥がしと選別だけを純粋関数へ出して固定する**
// （このリポジトリの既定の作法）。

import { describe, expect, it } from 'vitest';
import { parseLiveAgentSessionIds, parseLiveAgentSessions } from '../../src/main/pty/tmuxSessions';
import { buildTmuxSessionName } from '../../src/main/pty/tmux';

describe('parseLiveAgentSessionIds', () => {
  it('aiterm- 接頭辞を剥がして agentSessionId を返す', () => {
    const out = 'aiterm-36ad708d-8af3-4c0f-a4b7-6ce4c5a87bc2\naiterm-9317c02d-6160-44bc-8b03-75830b32a0a6\n';
    expect(parseLiveAgentSessionIds(out)).toEqual(
      new Set(['36ad708d-8af3-4c0f-a4b7-6ce4c5a87bc2', '9317c02d-6160-44bc-8b03-75830b32a0a6']),
    );
  });

  // 利用者が自分で作ったセッションを「戻せる」と言わない。
  it('このアプリ由来でないセッションは落とす', () => {
    const out = 'work\n0\nmy-project\naiterm-abc\n';
    expect(parseLiveAgentSessionIds(out)).toEqual(new Set(['abc']));
  });

  it('接頭辞だけで ID が空の行は落とす', () => {
    expect(parseLiveAgentSessionIds('aiterm-\naiterm-abc\n')).toEqual(new Set(['abc']));
  });

  it('空・空行だけの出力では空集合になる', () => {
    expect(parseLiveAgentSessionIds('')).toEqual(new Set());
    expect(parseLiveAgentSessionIds('\n\n  \n')).toEqual(new Set());
  });

  it('前後の空白を落とす', () => {
    expect(parseLiveAgentSessionIds('  aiterm-abc  \n')).toEqual(new Set(['abc']));
  });

  // ⭐ 剥がす側と付ける側が同じ規約であることを、文字列リテラルではなく
  // 実際の組み立て関数と突き合わせて固定する（片方だけ変えたら赤くなる）。
  it('buildTmuxSessionName が付けた名前を、そのまま元の ID に戻せる', () => {
    const id = 'e2f9c1a0-1111-2222-3333-444455556666';
    expect(parseLiveAgentSessionIds(buildTmuxSessionName(id))).toEqual(new Set([id]));
  });
});

// 生きているセッションの要約（#180 周13 PR 1）。
//
// **12番の本体を解く材料。** 会話0往復の gemini は `gemini --list-sessions` に
// 永久に出ないが、**tmux には provider と UUID ごと残っている**（2026-08-06 実測）。
// ⭐ **provider は `pane_start_command` の先頭語から確定する。セッション名から推測しない。**
describe('parseLiveAgentSessions', () => {
  const SEP = '\x1f';
  const line = (name: string, cmd: string, cwd: string) => [name, cmd, cwd].join(SEP);

  it('claude / gemini を起動コマンドから確定する', () => {
    const out = [
      line('aiterm-aaa', 'claude --session-id aaa', '/work/a'),
      line('aiterm-bbb', 'gemini --session-id bbb', '/work/b'),
    ].join('\n');
    expect(parseLiveAgentSessions(out)).toEqual([
      { agentSessionId: 'aaa', provider: 'claude', cwd: '/work/a' },
      { agentSessionId: 'bbb', provider: 'gemini', cwd: '/work/b' },
    ]);
  });

  // ⭐ 12番の本体。`--list-sessions` に出ないセッションでも、ここには出る。
  it('会話0往復の gemini も拾える（tmux は往復数を知らない）', () => {
    const out = line('aiterm-zero', 'gemini --session-id zero', '/tmp/x');
    expect(parseLiveAgentSessions(out)).toEqual([
      { agentSessionId: 'zero', provider: 'gemini', cwd: '/tmp/x' },
    ]);
  });

  it('絶対パスで起動されていても CLI を判別できる', () => {
    const out = line('aiterm-ccc', '/usr/local/bin/gemini --session-id ccc', '/w');
    expect(parseLiveAgentSessions(out)[0]?.provider).toBe('gemini');
  });

  // ⛔ 「たぶん claude」と推測しない。
  it('CLI を確定できない行は落とす（シェルだけの tmux セッション等）', () => {
    const out = [line('aiterm-ddd', 'zsh -l', '/w'), line('aiterm-eee', '', '/w')].join('\n');
    expect(parseLiveAgentSessions(out)).toEqual([]);
  });

  it('このアプリ由来でないセッションは落とす', () => {
    const out = [line('work', 'claude --session-id x', '/w'), line('aiterm-fff', 'claude', '/w')].join('\n');
    expect(parseLiveAgentSessions(out).map((s) => s.agentSessionId)).toEqual(['fff']);
  });

  // 利用者が tmux の中で自分でペインを分割していると、同じセッションが複数行来る。
  it('同じセッションが複数行来ても1本に畳む', () => {
    const out = [
      line('aiterm-ggg', 'claude --session-id ggg', '/w'),
      line('aiterm-ggg', 'zsh', '/w/sub'),
    ].join('\n');
    expect(parseLiveAgentSessions(out)).toEqual([
      { agentSessionId: 'ggg', provider: 'claude', cwd: '/w' },
    ]);
  });

  // 区切りに空白や | を使うと、cwd や起動コマンドの中身で壊れる。
  it('cwd に空白が含まれていても壊れない', () => {
    const out = line('aiterm-hhh', 'claude --session-id hhh', '/Users/me/My Projects/a b');
    expect(parseLiveAgentSessions(out)[0]?.cwd).toBe('/Users/me/My Projects/a b');
  });

  it('cwd が空なら undefined にする（空文字を配らない）', () => {
    expect(parseLiveAgentSessions(line('aiterm-iii', 'claude', ''))[0]?.cwd).toBeUndefined();
  });

  it('空・空行だけの出力では空配列', () => {
    expect(parseLiveAgentSessions('')).toEqual([]);
    expect(parseLiveAgentSessions('\n\n')).toEqual([]);
  });

  // ⛔ 起動コマンドの文字列を外へ出さない（採番した UUID が生で載る）。
  it('戻り値に起動コマンドの文字列を含めない', () => {
    const out = line('aiterm-jjj', 'claude --session-id jjj', '/w');
    expect(JSON.stringify(parseLiveAgentSessions(out))).not.toContain('--session-id');
  });
});
