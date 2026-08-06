// 生きている tmux セッションの一覧（#180 周12 / 2026-08-06）。
//
// **何を守っているか。** タスク一覧の行は「そのセッションを開いているタブがある」
// ときしか押せなかった。タブの構成はどこにも永続化していないので、**アプリを再起動した
// 瞬間、走っているセッションは全部「一覧には出るが押せない行」になっていた。**
//
// tmux を叩く側は単体で回せないので、**接頭辞の剥がしと選別だけを純粋関数へ出して固定する**
// （このリポジトリの既定の作法）。

import { describe, expect, it } from 'vitest';
import { parseLiveAgentSessionIds } from '../../src/main/pty/tmuxSessions';
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
