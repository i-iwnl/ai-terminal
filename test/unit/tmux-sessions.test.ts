// 生きている tmux セッションの一覧（#180 周12 / 2026-08-06）。
//
// **何を守っているか。** タスク一覧の行は「そのセッションを開いているタブがある」
// ときしか押せなかった。タブの構成はどこにも永続化していないので、**アプリを再起動した
// 瞬間、走っているセッションは全部「一覧には出るが押せない行」になっていた。**
//
// tmux を叩く側は単体で回せないので、**接頭辞の剥がしと選別だけを純粋関数へ出して固定する**
// （このリポジトリの既定の作法）。

import { describe, expect, it } from 'vitest';
import {
  LIVE_SESSION_FORMAT,
  parseLiveAgentSessionIds,
  parseLiveAgentSessions,
} from '../../src/main/pty/tmuxSessions';
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
  // フィールド順は LIVE_SESSION_FORMAT と同じ（name / pane_pid / start_command / cwd）。
  const line = (name: string, cmd: string, cwd: string, pid = '1234') =>
    [name, pid, cmd, cwd].join(SEP);

  it('claude / gemini を起動コマンドから確定する', () => {
    const out = [
      line('aiterm-aaa', 'claude --session-id aaa', '/work/a'),
      line('aiterm-bbb', 'gemini --session-id bbb', '/work/b'),
    ].join('\n');
    expect(parseLiveAgentSessions(out)).toEqual([
      { agentSessionId: 'aaa', provider: 'claude', cwd: '/work/a', panePid: 1234 },
      { agentSessionId: 'bbb', provider: 'gemini', cwd: '/work/b', panePid: 1234 },
    ]);
  });

  // ⭐ 12番の本体。`--list-sessions` に出ないセッションでも、ここには出る。
  it('会話0往復の gemini も拾える（tmux は往復数を知らない）', () => {
    const out = line('aiterm-zero', 'gemini --session-id zero', '/tmp/x');
    expect(parseLiveAgentSessions(out)).toEqual([
      { agentSessionId: 'zero', provider: 'gemini', cwd: '/tmp/x', panePid: 1234 },
    ]);
  });

  // ⭐ sessionId が乖離したときの唯一の突き合わせ材料（session-match.test.ts が使う）。
  describe('pane_pid', () => {
    it('ペインの pid を数値で取り出す', () => {
      const out = line('aiterm-aaa', 'claude --session-id aaa', '/w', '60756');
      expect(parseLiveAgentSessions(out)[0]?.panePid).toBe(60756);
    });

    it('前後に空白があっても読める', () => {
      const out = line('aiterm-aaa', 'claude --session-id aaa', '/w', '  60756 ');
      expect(parseLiveAgentSessions(out)[0]?.panePid).toBe(60756);
    });

    it('数値でなければ undefined に倒す（書式が変わっても pid として使わない）', () => {
      expect(parseLiveAgentSessions(line('aiterm-a', 'claude', '/w', ''))[0]?.panePid).toBeUndefined();
      expect(
        parseLiveAgentSessions(line('aiterm-a', 'claude', '/w', 'abc'))[0]?.panePid,
      ).toBeUndefined();
    });

    it('0 や負の値は pid ではないので undefined に倒す', () => {
      expect(parseLiveAgentSessions(line('aiterm-a', 'claude', '/w', '0'))[0]?.panePid).toBeUndefined();
      expect(parseLiveAgentSessions(line('aiterm-a', 'claude', '/w', '-1'))[0]?.panePid).toBeUndefined();
    });

    it('小数は pid ではないので undefined に倒す', () => {
      expect(
        parseLiveAgentSessions(line('aiterm-a', 'claude', '/w', '12.5'))[0]?.panePid,
      ).toBeUndefined();
    });
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
      { agentSessionId: 'ggg', provider: 'claude', cwd: '/w', panePid: 1234 },
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

// ⭐ **書式とパーサがずれたことを検出する唯一の関門。**
//
// 上の `parseLiveAgentSessions` のテストは**手で組んだ行**を食わせているので、
// `LIVE_SESSION_FORMAT` 側だけを変えても1本も落ちない。実際、`pane_pid` を
// 足す周で「書式からフィールドを1つ落とす」壊し方を試したところ**全部緑のまま**だった
// （2026-08-07 実測）。
//
// これは無害な取りこぼしではない。フィールドが1つずれると
// **provider を cwd から読もうとして全行が捨てられ、一覧が丸ごと空になる**
// （= 走っているセッションが全部「押せない行」に戻る）。しかも tmux を叩く側は
// 単体で回せないので、E2E でも実機でしか気づけない。
//
// **書式そのものから行を組み立てて**パースさせることで、両者を縛る。
describe('LIVE_SESSION_FORMAT とパーサの対応', () => {
  const SEP = '\x1f';

  /** 書式に現れてよいフィールドと、そこに来る想定の値。 */
  const SPECIMEN: Record<string, string> = {
    '#{session_name}': 'aiterm-aaa',
    '#{pane_pid}': '60756',
    '#{pane_start_command}': 'claude --session-id aaa',
    '#{pane_current_path}': '/work/a',
  };

  const fields = LIVE_SESSION_FORMAT.split(SEP);

  // 書式にフィールドを足したのにパーサを直し忘れた場合、まずここで気づける。
  it('書式に未知のフィールドが増えていない', () => {
    expect(fields.filter((f) => !(f in SPECIMEN))).toEqual([]);
  });

  it('書式から組み立てた行を、パーサが同じ並びで読める', () => {
    const out = fields.map((f) => SPECIMEN[f] ?? '').join(SEP);
    expect(parseLiveAgentSessions(out)).toEqual([
      { agentSessionId: 'aaa', provider: 'claude', cwd: '/work/a', panePid: 60756 },
    ]);
  });
});
