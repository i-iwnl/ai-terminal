// タブを閉じる確認ダイアログの文言（Issue #121 A-3 / 周2）。
//
// **E2E ハーネスは `useTmux: false` 固定**なので、tmux ラップの分岐は
// E2E からはそのままでは踏めない。ここが唯一の関門になる。

import { describe, expect, it } from 'vitest';

import {
  closeTabCopy,
  needsCloseConfirmation,
  summarizeClosingPanes,
  type ClosingPaneSummary,
} from '../../src/renderer/src/tabs/closeTabCopy';
import type { PaneLeaf } from '../../src/renderer/src/tabs/paneTree';

function leaf(overrides: Partial<PaneLeaf> = {}): PaneLeaf {
  return {
    kind: 'leaf',
    paneId: 'p1',
    ptyId: 'p1',
    ptyKind: 'shell',
    title: 'zsh',
    ...overrides,
  };
}

describe('summarizeClosingPanes', () => {
  it('tmux でラップされていないペインは「終了する」側に数える', () => {
    expect(summarizeClosingPanes([leaf(), leaf({ paneId: 'p2', ptyId: 'p2' })])).toEqual({
      exiting: 2,
      persistentResumable: 0,
      persistentOrphaned: 0,
    });
  });

  it('tmux + claude は「再開できる」側に数える', () => {
    const s = summarizeClosingPanes([leaf({ ptyKind: 'claude', wrappedInTmux: true })]);
    expect(s).toEqual({ exiting: 0, persistentResumable: 1, persistentOrphaned: 0 });
  });

  it('tmux + gemini は「回収できない」側に数える（claude と混ぜない）', () => {
    const s = summarizeClosingPanes([leaf({ ptyKind: 'gemini', wrappedInTmux: true })]);
    expect(s).toEqual({ exiting: 0, persistentResumable: 0, persistentOrphaned: 1 });
  });

  it('tmux ラップでも wrappedInTmux が false なら終了する側', () => {
    // 設定を切っている / tmux が入っていない環境。
    const s = summarizeClosingPanes([leaf({ ptyKind: 'claude', wrappedInTmux: false })]);
    expect(s).toEqual({ exiting: 1, persistentResumable: 0, persistentOrphaned: 0 });
  });

  it('既に終了しているペインは数えない（閉じても失われるものが無い）', () => {
    const s = summarizeClosingPanes([
      leaf({ exit: { exitCode: 0 } }),
      leaf({ paneId: 'p2', ptyId: 'p2', ptyKind: 'claude', wrappedInTmux: true }),
    ]);
    expect(s).toEqual({ exiting: 0, persistentResumable: 1, persistentOrphaned: 0 });
  });

  it('混在をそれぞれの側に振り分ける', () => {
    const s = summarizeClosingPanes([
      leaf(),
      leaf({ paneId: 'p2', ptyId: 'p2', ptyKind: 'claude', wrappedInTmux: true }),
      leaf({ paneId: 'p3', ptyId: 'p3', ptyKind: 'gemini', wrappedInTmux: true }),
    ]);
    expect(s).toEqual({ exiting: 1, persistentResumable: 1, persistentOrphaned: 1 });
  });
});

describe('closeTabCopy', () => {
  const summary = (o: Partial<ClosingPaneSummary> = {}): ClosingPaneSummary => ({
    exiting: 0,
    persistentResumable: 0,
    persistentOrphaned: 0,
    ...o,
  });

  it('tmux ラップが無いときは従来どおりの文言（characterization）', () => {
    expect(closeTabCopy(summary({ exiting: 2 }))).toEqual({
      title: '走行中のプロセス 2 件を終了します',
      body: 'このタブを閉じると、中で動いている 2 件のプロセスがすべて終了します。',
      confirmLabel: '終了する',
    });
  });

  // **この Issue の本体。** 実測（tmux 3.7b）でプロセスは生き残ることが
  // 確定しているので、「すべて終了します」と言ってはいけない。
  it('全部が生き残るときに「終了」と言わない', () => {
    const copy = closeTabCopy(summary({ persistentResumable: 2 }));
    expect(copy.title).not.toContain('終了');
    expect(copy.body).not.toContain('終了');
    expect(copy.confirmLabel).not.toContain('終了');
    expect(copy.body).toContain('動き続けます');
  });

  it('生き残るときは、有効になっている設定の項目名をそのまま出す', () => {
    // 別の言い回しを発明すると、ユーザーが自分でオンにしたトグルと結びつけられない。
    expect(closeTabCopy(summary({ persistentResumable: 1 })).body).toContain(
      'アプリを閉じても AI の作業を続ける',
    );
  });

  it('claude は再開できると伝える', () => {
    expect(closeTabCopy(summary({ persistentResumable: 1 })).body).toContain('履歴');
  });

  it('gemini は開き直せないことを明示する（claude と混ぜない）', () => {
    const copy = closeTabCopy(summary({ persistentOrphaned: 1 }));
    expect(copy.body).toContain('gemini');
    expect(copy.body).toContain('開き直す手段がありません');
    // claude が1件も無いのに「履歴から再開できます」と言わない。
    expect(copy.body).not.toContain('再開できます');
  });

  it('混在では、終了する数と生き残る数を両方出す', () => {
    const copy = closeTabCopy(summary({ exiting: 1, persistentResumable: 2 }));
    expect(copy.title).toContain('1 件を終了します');
    expect(copy.title).toContain('2 件');
    expect(copy.body).toContain('1 件のプロセスは終了しますが');
    expect(copy.confirmLabel).toBe('タブを閉じる');
  });

  it('件数は「閉じても生き残る合計」で数える（claude と gemini の和）', () => {
    const copy = closeTabCopy(summary({ persistentResumable: 1, persistentOrphaned: 2 }));
    expect(copy.body).toContain('3 件の AI の作業');
  });
});

// --- 確認ダイアログを出すかどうかの判定（App.tsx の requestCloseTab）-----------
//
// 判定そのものは App.tsx の中にあるが、**その判定が読む値**を
// summarizeClosingPanes が作る。ここでは「1ペインでも確認が要る」条件が
// 内訳から一意に決まることを固定する。
describe('1ペインでも確認が要る条件（persistentOrphaned > 0）', () => {
  it('tmux + gemini が1枚だけなら、回収不能なので確認が要る', () => {
    const s = summarizeClosingPanes([leaf({ ptyKind: 'gemini', wrappedInTmux: true })]);
    expect(s.persistentOrphaned).toBeGreaterThan(0);
  });

  it('tmux + claude が1枚だけなら、履歴から戻れるので確認は要らない', () => {
    const s = summarizeClosingPanes([leaf({ ptyKind: 'claude', wrappedInTmux: true })]);
    expect(s.persistentOrphaned).toBe(0);
  });

  it('tmux ラップ無しのシェル1枚なら確認は要らない', () => {
    expect(summarizeClosingPanes([leaf()]).persistentOrphaned).toBe(0);
  });
});

// Issue #158。**確認ダイアログを出すかどうかの判定を、1箇所に集める。**
//
// それまで判定は `App.tsx` の `requestCloseTab` の中に直接書かれており、
// `Cmd+W`（`close-pane`）は `closeActivePane` を直接呼ぶ別経路で
// **その判定を1度も通らなかった**。tmux + gemini のペインを `Cmd+W` で
// 閉じると、確認も通知も出ないまま、アプリからは二度と回収できない
// tmux セッションとプロセスが残る。
//
// **`Cmd+W` は `Cmd+Option+W` より押しやすく、実運用ではこちらが主要な経路になる。**
describe('needsCloseConfirmation', () => {
  // --- Issue #158 の完了条件が名指しした「1 leaf」の3ケース --------------------

  it('1 leaf・tmux + gemini: **確認する**（閉じると二度と回収できない）', () => {
    const leaves = [leaf({ ptyKind: 'gemini', wrappedInTmux: true })];
    expect(needsCloseConfirmation(leaves)).toBe(true);
  });

  it('1 leaf・tmux + claude: 確認しない（履歴から resume できる）', () => {
    // **claude で止めてはいけない。** 閉じるのは1日に何十回もある操作で、
    // 確認は不可逆なものだけに絞る、というのが #121 周5 で決めた原則。
    const leaves = [leaf({ ptyKind: 'claude', wrappedInTmux: true })];
    expect(needsCloseConfirmation(leaves)).toBe(false);
  });

  it('1 leaf・tmux 無し: 確認しない（従来どおり即座に閉じる）', () => {
    expect(needsCloseConfirmation([leaf({ ptyKind: 'shell' })])).toBe(false);
    expect(needsCloseConfirmation([leaf({ ptyKind: 'claude' })])).toBe(false);
    expect(needsCloseConfirmation([leaf({ ptyKind: 'gemini' })])).toBe(false);
  });

  // --- 既存の条件（2本以上）を壊していないこと --------------------------------

  it('2本以上を一度に閉じるなら、中身に関わらず確認する', () => {
    const leaves = [leaf({ paneId: 'a' }), leaf({ paneId: 'b' })];
    expect(needsCloseConfirmation(leaves)).toBe(true);
  });

  it('0本なら確認しない', () => {
    expect(needsCloseConfirmation([])).toBe(false);
  });

  // --- 既に終了しているペインの扱い（summarizeClosingPanes と揃っていること）---

  it('**既に終了している gemini では確認しない**（閉じても失われるものが無い）', () => {
    // `summarizeClosingPanes` が `exit` の立った leaf を数えないので、
    // orphaned は 0 になる。**ここが揃っていないと「終了したタブを閉じるだけで
    // 毎回ダイアログ」になる**（`Cmd+W` の手数が実質倍になる）。
    const leaves = [leaf({ ptyKind: 'gemini', wrappedInTmux: true, exit: { exitCode: 0 } })];
    expect(needsCloseConfirmation(leaves)).toBe(false);
  });

  // --- 「その操作で実際に閉じるペイン」を渡す、という契約 ----------------------

  it('引数は「実際に閉じるペイン」。ペイン1枚を閉じるならその1枚だけを渡す', () => {
    // 3枚のうち gemini 1枚だけを閉じる場合 -> 確認する
    const gemini = leaf({ paneId: 'g', ptyKind: 'gemini', wrappedInTmux: true });
    expect(needsCloseConfirmation([gemini])).toBe(true);
    // 同じ木でも、閉じるのがシェル1枚なら確認しない
    expect(needsCloseConfirmation([leaf({ paneId: 's' })])).toBe(false);
  });
});
