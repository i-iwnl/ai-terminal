// タブを閉じる確認ダイアログの文言（Issue #121 A-3 / 周2）。
//
// **E2E ハーネスは `useTmux: false` 固定**なので、tmux ラップの分岐は
// E2E からはそのままでは踏めない。ここが唯一の関門になる。

import { describe, expect, it } from 'vitest';

import {
  closedTabChannel,
  closeTabCopy,
  closedTabAnnouncement,
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

/**
 * 「閉じても再開できる」ペイン。
 *
 * ⭐ **`agentSessionId` を持つことが条件で、プロバイダは条件ではない**（Issue #155）。
 * Main の `buildClaudePlan` / `buildGeminiPlan` はどちらもこれを返す
 * （返せない縮退の条件は `src/main/pty/tmux.ts` 冒頭が唯一の正）。
 */
function resumableLeaf(kind: 'claude' | 'gemini', overrides: Partial<PaneLeaf> = {}): PaneLeaf {
  return leaf({
    ptyKind: kind,
    wrappedInTmux: true,
    agentSessionId: `${kind}-session-uuid`,
    ...overrides,
  });
}

describe('summarizeClosingPanes', () => {
  it('tmux でラップされていないペインは「終了する」側に数える', () => {
    expect(summarizeClosingPanes([leaf(), leaf({ paneId: 'p2', ptyId: 'p2' })])).toEqual({
      exiting: 2,
      persistentResumable: 0,
      resumableByProvider: {},
      persistentOrphaned: 0,
    });
  });

  it('tmux + claude は「再開できる」側に数える', () => {
    const s = summarizeClosingPanes([resumableLeaf('claude')]);
    expect(s).toEqual({
      exiting: 0,
      persistentResumable: 1,
      resumableByProvider: { claude: 1 },
      persistentOrphaned: 0,
    });
  });

  it('⭐ tmux + gemini も「再開できる」側（Issue #155。プロバイダでは分けない）', () => {
    const s = summarizeClosingPanes([resumableLeaf('gemini')]);
    expect(s).toEqual({
      exiting: 0,
      persistentResumable: 1,
      resumableByProvider: { gemini: 1 },
      persistentOrphaned: 0,
    });
  });

  it('⚠ tmux でラップされたのに agentSessionId が無ければ「回収できない」側（縮退）', () => {
    // CLI が古い / 履歴から UUID を取れなかった場合。条件の全文は src/main/pty/tmux.ts 冒頭。
    // **未知は必ずこちら側に落とす**のがこの分類の要点。
    const s = summarizeClosingPanes([leaf({ ptyKind: 'gemini', wrappedInTmux: true })]);
    expect(s).toEqual({
      exiting: 0,
      persistentResumable: 0,
      resumableByProvider: {},
      persistentOrphaned: 1,
    });
  });

  it('⚠ claude でも agentSessionId が無ければ「回収できない」側（プロバイダで免除しない）', () => {
    const s = summarizeClosingPanes([leaf({ ptyKind: 'claude', wrappedInTmux: true })]);
    expect(s.persistentOrphaned).toBe(1);
    expect(s.persistentResumable).toBe(0);
  });

  it('tmux ラップでも wrappedInTmux が false なら終了する側', () => {
    // 設定を切っている / tmux が入っていない環境。
    const s = summarizeClosingPanes([resumableLeaf('claude', { wrappedInTmux: false })]);
    expect(s).toEqual({
      exiting: 1,
      persistentResumable: 0,
      resumableByProvider: {},
      persistentOrphaned: 0,
    });
  });

  it('既に終了しているペインは数えない（閉じても失われるものが無い）', () => {
    const s = summarizeClosingPanes([
      leaf({ exit: { exitCode: 0 } }),
      resumableLeaf('claude', { paneId: 'p2', ptyId: 'p2' }),
    ]);
    expect(s).toEqual({
      exiting: 0,
      persistentResumable: 1,
      resumableByProvider: { claude: 1 },
      persistentOrphaned: 0,
    });
  });

  it('混在をそれぞれの側に振り分け、再開できるものはプロバイダ別に数える', () => {
    const s = summarizeClosingPanes([
      leaf(),
      resumableLeaf('claude', { paneId: 'p2', ptyId: 'p2' }),
      resumableLeaf('gemini', { paneId: 'p3', ptyId: 'p3' }),
      leaf({ paneId: 'p4', ptyId: 'p4', ptyKind: 'gemini', wrappedInTmux: true }),
    ]);
    expect(s).toEqual({
      exiting: 1,
      persistentResumable: 2,
      resumableByProvider: { claude: 1, gemini: 1 },
      persistentOrphaned: 1,
    });
  });
});

describe('closeTabCopy', () => {
  const summary = (o: Partial<ClosingPaneSummary> = {}): ClosingPaneSummary => ({
    exiting: 0,
    persistentResumable: 0,
    resumableByProvider: {},
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

  it('再開できるものは、プロバイダ名つきで行き先まで伝える', () => {
    // ⭐ 履歴パネルは Claude / Gemini のトグルで分かれており**既定は Claude**。
    // 「履歴から再開できます」だけだと、Gemini を閉じた人は空の一覧を見て
    // 「嘘だった」と判断する（design-review で3人が独立に指摘）。
    const copy = closeTabCopy(
      summary({ persistentResumable: 1, resumableByProvider: { gemini: 1 } }),
    );
    expect(copy.body).toContain('Gemini 1 件');
    expect(copy.body).toContain('履歴');
    expect(copy.body).toContain('切り替え');
  });

  it('⛔ プロバイダ名を決め打ちしない（混在すると必ず嘘になる）', () => {
    // 直す前は `（claude）` をリテラルで埋めており、内訳を数えていないのに
    // 名前を書いていた。claude 1 + gemini 1 を一度に閉じると必ず嘘になる。
    const copy = closeTabCopy(
      summary({ persistentResumable: 2, resumableByProvider: { claude: 1, gemini: 1 } }),
    );
    expect(copy.body).toContain('Claude 1 件');
    expect(copy.body).toContain('Gemini 1 件');
  });

  it('⛔ 文言に括弧を使わない（VoiceOver の句読点設定に依存させない）', () => {
    // 「すべて」設定なら「かっこ」と発話され、「なし」設定なら語の境界が消える。
    // どちらの設定でも良くならないので、**設定に依存しない解**として括弧を外す
    // （#150 でコロンを外したのと同じ判断）。
    for (const s of [
      summary({ persistentResumable: 2, resumableByProvider: { claude: 1, gemini: 1 } }),
      summary({ persistentOrphaned: 1 }),
      summary({ exiting: 1, persistentResumable: 1, resumableByProvider: { claude: 1 } }),
    ]) {
      expect(closeTabCopy(s).body).not.toMatch(/[（）()]/);
    }
  });

  it('再開先を特定できないものは、開き直せないことを明示する', () => {
    const copy = closeTabCopy(summary({ persistentOrphaned: 1 }));
    expect(copy.body).toContain('開き直せません');
    // 再開できるものが1件も無いのに「履歴から再開できます」と言わない。
    expect(copy.body).not.toContain('再開できます');
    // ⛔ プロバイダ名を決め打ちしない（この分岐はもう gemini 特有ではない）。
    expect(copy.body).not.toContain('gemini');
    expect(copy.body).not.toContain('Gemini');
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
  it('⚠ tmux ラップされたのに agentSessionId が無い1枚なら、回収不能なので確認が要る（縮退）', () => {
    const s = summarizeClosingPanes([leaf({ ptyKind: 'gemini', wrappedInTmux: true })]);
    expect(s.persistentOrphaned).toBeGreaterThan(0);
  });

  it('tmux + claude が1枚だけなら、履歴から戻れるので確認は要らない', () => {
    expect(summarizeClosingPanes([resumableLeaf('claude')]).persistentOrphaned).toBe(0);
  });

  it('⭐ tmux + gemini が1枚だけでも、履歴から戻れるので確認は要らない（Issue #155）', () => {
    expect(summarizeClosingPanes([resumableLeaf('gemini')]).persistentOrphaned).toBe(0);
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
describe('closedTabAnnouncement（確認ダイアログを消した分の受け皿）', () => {
  const summary = (o: Partial<ClosingPaneSummary> = {}): ClosingPaneSummary => ({
    exiting: 0,
    persistentResumable: 0,
    resumableByProvider: {},
    persistentOrphaned: 0,
    ...o,
  });

  it('生き残るものが無ければ、従来どおり結果だけを告知する', () => {
    expect(closedTabAnnouncement(summary({ exiting: 2 }))).toBe('タブを閉じました');
  });

  it('⭐ 生き残るものがあれば「終了せず残っている」ことまで告知する', () => {
    // 確認ダイアログは「閉じても走り続けている」を伝える唯一の面だった。
    // 消しっぱなしにすると、**支援技術利用者だけが一方的に情報を失う**
    // （視覚利用者は履歴パネルを眺めて発見できるが、その『眺める』が無い）。
    const msg = closedTabAnnouncement(
      summary({ persistentResumable: 1, resumableByProvider: { gemini: 1 } }),
    );
    expect(msg).toContain('終了せず残っています');
    expect(msg).toContain('Gemini 1 件');
    expect(msg).toContain('履歴');
  });

  it('回収できないものがあれば、それも件数つきで告知する', () => {
    const msg = closedTabAnnouncement(summary({ persistentOrphaned: 1 }));
    expect(msg).toContain('終了せず残っています');
    expect(msg).toContain('開き直せません');
  });

  it('⛔ 括弧を使わない（VoiceOver の句読点設定に依存させない）', () => {
    const msg = closedTabAnnouncement(
      summary({ persistentResumable: 2, resumableByProvider: { claude: 1, gemini: 1 } }),
    );
    expect(msg).not.toMatch(/[（）()]/);
  });

  it('結果が先、内訳が後（読み上げは中断できないので最初の数文字で行動が決まる）', () => {
    const msg = closedTabAnnouncement(
      summary({ persistentResumable: 1, resumableByProvider: { claude: 1 } }),
    );
    expect(msg.startsWith('タブを閉じました')).toBe(true);
  });
});

describe('needsCloseConfirmation', () => {
  // --- Issue #158 の完了条件が名指しした「1 leaf」の3ケース --------------------

  it('⚠ 1 leaf・tmux + agentSessionId 無し: **確認する**（閉じると二度と回収できない）', () => {
    const leaves = [leaf({ ptyKind: 'gemini', wrappedInTmux: true })];
    expect(needsCloseConfirmation(leaves)).toBe(true);
  });

  it('1 leaf・tmux + claude: 確認しない（履歴から resume できる）', () => {
    // **戻れるもので止めてはいけない。** 閉じるのは1日に何十回もある操作で、
    // 確認は不可逆なものだけに絞る、というのが #121 周5 で決めた原則。
    expect(needsCloseConfirmation([resumableLeaf('claude')])).toBe(false);
  });

  it('⭐ 1 leaf・tmux + gemini: 確認しない（Issue #155 で戻れるようになった）', () => {
    expect(needsCloseConfirmation([resumableLeaf('gemini')])).toBe(false);
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

// ⭐ 「閉じても AI は走り続けている」を、どの面へ流すか（2026-08-07）。
//
// **この判定が無かった間、その事実は `.app-status`（`clip: rect(0,0,0,0)` で
// 画面から隠された live region）にしか流れていなかった。** Issue #155 が
// 「確認ダイアログを消すと得をするのが晴眼キーボード利用者だけになる」と
// 心配した非対称が、ちょうど裏返しの形で実現していた（design-review で
// 5人中4人が独立に指摘）。
//
// ⛔ 「両方に流さない」を守る唯一の場所なので、呼び出し側に分岐を戻さないこと。
describe('closedTabChannel', () => {
  const summary = (over: Partial<ClosingPaneSummary> = {}): ClosingPaneSummary => ({
    exiting: 0,
    persistentResumable: 0,
    resumableByProvider: {},
    persistentOrphaned: 0,
    ...over,
  });

  it('再開できるものが残るなら、視覚に出る通知バナーへ流す', () => {
    expect(closedTabChannel(summary({ persistentResumable: 1 }))).toBe('notice');
  });

  it('拾い直せないものが残るなら、なおさら通知バナーへ流す', () => {
    expect(closedTabChannel(summary({ persistentOrphaned: 1 }))).toBe('notice');
  });

  it('両方あるときも通知バナー', () => {
    expect(closedTabChannel(summary({ persistentResumable: 2, persistentOrphaned: 1 }))).toBe(
      'notice',
    );
  });

  it('何も残らないなら live region だけ（タブが消えたのは目で見れば分かる）', () => {
    expect(closedTabChannel(summary())).toBe('announce');
  });

  // ⛔ `exiting` は「本当に終了した」= 残っていない、なので通知バナーへ出さない。
  // ここを混ぜると、シェルタブを閉じるたびにバナーが出て雑音になる。
  it('本当に終了しただけならバナーを出さない', () => {
    expect(closedTabChannel(summary({ exiting: 3 }))).toBe('announce');
  });
});
