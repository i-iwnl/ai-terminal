// タブを閉じる確認ダイアログの文言を決める純粋関数（Issue #121 A-3 / 周2）。
//
// **なぜ切り出したか。** それまでの文言は「中で動いている N 件のプロセスが
// すべて終了します」で固定だったが、**既定構成ではこれが事実に反する**。
//
// 実測（2026-08-03 / tmux 3.7b / 実アプリを agent-browser で操作）:
// claude タブを閉じたあとも `tmux ls` にセッションが残り、
// `ps` に `claude --session-id … (Ss+)` が生存していた。
// `pty.kill()` が殺すのは tmux **クライアント**だけで、サーバ側のセッションと
// 中の claude / gemini は生き残るため。
//
// ⚠ **E2E ハーネスの既定は `useTmux: false`** だが、**固定ではない**
// （`launchApp({ config: { useTmux: true }, fakeTmux: true })` で上書きでき、
// S84 / S90 / S102 / S103 が実際にこの分岐を踏んでいる）。
// それでも判定は純粋関数に切り出して `test/unit/` でも固定する
// （このリポジトリの既定の作法。resizeGate / computeYourTurnSince / paneHeader 等と同じ形）。
// **偽 tmux は `-A` のアタッチ分岐を再現しない**ので、E2E で守れるのは
// 「どう分類するか」までで、「実際に戻れるか」は実機確認の担当。
//
// **回収できるかは `agentSessionId` を持つかで決まる。** tmux セッション名は
// `buildTmuxSessionName(plan.agentSessionId ?? ptyId)` で決まり、これが無いと
// 起動のたびに使い捨てる ptyId に落ちて、**閉じるとその名前を二度と再現できない**。
// ⭐ **条件の全文は src/main/pty/tmux.ts 冒頭が唯一の正**（ここに書き写さない。
// 書き写すと片方だけ古くなって「どちらが正か分からない」状態になる。実際に一度そうなった）。
//
// ⭐ **分類は `ptyKind` ではなく `agentSessionId` の有無で行う**（Issue #155）。
// プロバイダ名で分けると、同じ CLI でも縮退している場合（CLI が古い / 履歴から UUID を
// 取れなかった）を取りこぼす。**「再開先を特定できる鍵を持っているか」が唯一の条件。**

import type { PtyKind } from '@shared/ipc';

import type { PaneLeaf } from './paneTree';
import { providerLabel } from './tabProvider';

/** 閉じようとしているタブの中身を、閉じた結果ごとに数えたもの。 */
export interface ClosingPaneSummary {
  /** 閉じると本当に終了する PTY の本数（tmux でラップされていないもの）。 */
  exiting: number;
  /** 閉じても動き続け、履歴から再開できるもの（tmux + agentSessionId あり）。 */
  persistentResumable: number;
  /**
   * 再開できるものの内訳（プロバイダごとの件数）。
   *
   * **なぜ内訳が要るか。** 行き先である履歴パネルは Claude / Gemini のトグルで分かれており
   * **既定は Claude**（`HistoryList.tsx`）。「履歴から再開できます」とだけ言うと、
   * Gemini を閉じた人は自分のセッションが無い画面を見て「嘘だった」と判断する。
   * かつ**タブのプロバイダ帯は2型色覚で 1.04 = 区別不能**なので、
   * **画面に残っている手がかりは語だけ**（design-review で3人が独立に指摘）。
   */
  resumableByProvider: Partial<Record<PtyKind, number>>;
  /**
   * 閉じても動き続けるが、アプリからは二度と拾い直せないもの
   * （tmux でラップされたが `agentSessionId` を持たない）。
   *
   * ⚠ **到達する。** `SessionHistoryEntry.stableId` は optional で、CLI が古いときや
   * 履歴から UUID を取れなかったときに `agentSessionId` は undefined になる
   * （条件の全文は `src/main/pty/tmux.ts` 冒頭）。**未知は必ずこちら側に落とす**
   * のがこの分類の要点で、「回収できる」と嘘をつくより安全側。
   */
  persistentOrphaned: number;
}

/** ダイアログに出す3つの文字列。 */
export interface CloseTabCopy {
  title: string;
  body: string;
  /** 実行ボタンのラベル。何も終了しないなら「終了する」と言わない。 */
  confirmLabel: string;
}

/**
 * ペインの木を平らにしたものから、閉じた結果ごとの内訳を数える。
 *
 * **既に終了しているペイン（`exit` が立っている）は数えない。** 閉じても
 * 失われるものが無いため。
 */
export function summarizeClosingPanes(leaves: readonly PaneLeaf[]): ClosingPaneSummary {
  const summary: ClosingPaneSummary = {
    exiting: 0,
    persistentResumable: 0,
    resumableByProvider: {},
    persistentOrphaned: 0,
  };
  for (const leaf of leaves) {
    if (leaf.exit) continue;
    if (!leaf.wrappedInTmux) {
      summary.exiting += 1;
    } else if (leaf.agentSessionId !== undefined) {
      // ⭐ **肯定条件でしか resumable に入れない。** 未知は必ず orphaned 側に落ちる。
      summary.persistentResumable += 1;
      const kind = leaf.ptyKind ?? 'shell';
      summary.resumableByProvider[kind] = (summary.resumableByProvider[kind] ?? 0) + 1;
    } else {
      // tmux でラップされたのに再開の鍵が無いもの。shell は tmux ラップされない
      // （maybeWrapWithTmux が kind === 'shell' で早期 return する）ので、
      // ここに来るのは claude / gemini の縮退した起動だけ。
      summary.persistentOrphaned += 1;
    }
  }
  return summary;
}

/** 設定パネル（SettingsPanel.tsx）に出ている語と揃える。別の言い回しを発明しない。 */
const PERSIST_SETTING_LABEL = 'アプリを閉じても AI の作業を続ける';

/** 内訳の並び順。件数で並べ替えると、同じ構成でも表示が揺れて読み上げが安定しない。 */
const PROVIDER_ORDER: readonly PtyKind[] = ['claude', 'gemini', 'shell'];

/**
 * 「N 件は履歴から再開できます」の1文を、プロバイダの内訳つきで組み立てる。
 *
 * **行き先まで言い切る。** 履歴パネルは Claude / Gemini のトグルで分かれており
 * 既定は Claude なので、「履歴から再開できます」だけだと Gemini を閉じた人が
 * 空の一覧を見て「嘘だった」と判断する（design-review で3人が独立に指摘）。
 */
function buildResumeNote(summary: ClosingPaneSummary): string {
  const parts = PROVIDER_ORDER.filter((kind) => (summary.resumableByProvider[kind] ?? 0) > 0).map(
    (kind) => `${providerLabel(kind)} ${summary.resumableByProvider[kind] ?? 0} 件`,
  );
  // 内訳が取れないとき（将来 ptyKind が増えた等）は件数だけで縮退する。
  if (parts.length === 0) {
    return `${summary.persistentResumable} 件はサイドバーの「履歴」から再開できます。`;
  }
  return `${parts.join('と')}はサイドバーの「履歴」から再開できます。履歴はプロバイダごとに分かれているので、パネル上部で切り替えてください。`;
}

/**
 * 内訳から文言を決める。
 *
 * 文言の原則（design-review の5ペルソナレビューより）:
 * - **結果を先、機構を後。** 読み上げは中断できないので、最初の数文字で行動が決まる
 * - **「tmux」を主語にしない。** ユーザーが有効にしたのは設定の項目名であって tmux ではない
 * - **何も終了しないのに「終了する」と言わない。** ボタンのラベルも結果に合わせる
 */
export function closeTabCopy(summary: ClosingPaneSummary): CloseTabCopy {
  const persistent = summary.persistentResumable + summary.persistentOrphaned;

  // 従来どおりの経路（tmux でラップされたペインが1つも無い）。
  // **ここは characterization**（いまそうなっている文言をそのまま固定する）。
  if (persistent === 0) {
    return {
      title: `走行中のプロセス ${summary.exiting} 件を終了します`,
      body: `このタブを閉じると、中で動いている ${summary.exiting} 件のプロセスがすべて終了します。`,
      confirmLabel: '終了する',
    };
  }

  // ⛔ **プロバイダ名を決め打ちしない。** 直す前は `（gemini）` / `（claude）` を
  // リテラルで埋めていたが、内訳を数えていないのに名前を書いていたため、
  // **混在すると必ず嘘になる**（claude 1 + gemini 1 のタブを Cmd+Option+W で閉じる形）。
  //
  // ⛔ **括弧を使わない。** VoiceOver は句読点の読み上げ設定によって「かっこ」を発話しうるし、
  // 「なし」設定だと語の境界が消える。**設定に依存しない解**として括弧を外す
  // （#150 でコロンを外したのと同じ判断）。
  //
  // 表記は `providerLabel()` から引く（`Claude` / `Gemini`）。利用者が探しに行く先の画面
  // （履歴パネルのトグル）に書いてある綴りと一致させる。
  const orphanNote =
    summary.persistentOrphaned > 0
      ? `そのうち ${summary.persistentOrphaned} 件は、アプリから開き直せません。続けたい作業なら、このタブは閉じないでください。`
      : '';
  const resumeNote = summary.persistentResumable > 0 ? buildResumeNote(summary) : '';

  // 全部が生き残る場合は「終了します」と言ってはいけない。
  if (summary.exiting === 0) {
    return {
      title: 'タブを閉じます（AI の作業は続きます）',
      body: [
        `設定の「${PERSIST_SETTING_LABEL}」が有効なため、このタブを閉じても ${persistent} 件の AI の作業はバックグラウンドで動き続けます。`,
        resumeNote,
        orphanNote,
      ]
        .filter(Boolean)
        .join(''),
      confirmLabel: 'タブを閉じる',
    };
  }

  // 混在。終了するものと生き残るものを両方数える。
  return {
    title: `プロセス ${summary.exiting} 件を終了します（AI の作業 ${persistent} 件は続きます）`,
    body: [
      `このタブを閉じると ${summary.exiting} 件のプロセスは終了しますが、設定の「${PERSIST_SETTING_LABEL}」が有効なため、AI の作業 ${persistent} 件はバックグラウンドで動き続けます。`,
      resumeNote,
      orphanNote,
    ]
      .filter(Boolean)
      .join(''),
    confirmLabel: 'タブを閉じる',
  };
}

/**
 * **閉じた直後の告知**（Issue #155 の design-review。4人が「確認を消すなら受け皿が要る」）。
 *
 * 確認ダイアログは「閉じても走り続けている」ことを伝える**唯一の面**だった。
 * gemini が回収可能になって確認が出なくなると、**その情報の総量がゼロになる**。
 * 視覚利用者は「タブが消えた」を目で確認できるが、**支援技術利用者にはその『眺める』が無い**
 * ので、消しっぱなしにすると**この変更で得をするのが晴眼キーボード利用者だけ**になる。
 *
 * ダイアログ（同意を求める割り込み）から通知（事後の告知）への**降格**であって、削除ではない。
 *
 * ⛔ **通知バナーと live region の両方に同じ文を流さない**（VoiceOver が2回読む）。
 * 呼び出し側は `announce` だけに渡すこと。
 */
export function closedTabAnnouncement(summary: ClosingPaneSummary): string {
  const persistent = summary.persistentResumable + summary.persistentOrphaned;
  if (persistent === 0) return 'タブを閉じました';
  const notes = [
    `タブを閉じました。AI の作業 ${persistent} 件は終了せず残っています。`,
    summary.persistentResumable > 0 ? buildResumeNote(summary) : '',
    summary.persistentOrphaned > 0
      ? `そのうち ${summary.persistentOrphaned} 件は、アプリから開き直せません。`
      : '',
  ];
  return notes.filter(Boolean).join('');
}

/**
 * **確認ダイアログを出すべきか**（Issue #121 周5 / #158）。
 *
 * 引数は「その操作で**実際に閉じる**ペイン」。タブごと閉じるなら木の全 leaf、
 * ペイン1枚を閉じるならその1枚。
 *
 * 判定は2つ:
 *
 * 1. **2本以上を一度に閉じる**（`Cmd+Shift+W` を新設していないので、
 *    タブバーの x ボタンがマウス経由の抜け穴にならないようにする）
 * 2. **1本でも、閉じると回収できなくなるものがある**（`persistentOrphaned > 0`）。
 *    tmux でラップされた gemini は閉じた時点で tmux セッション名を二度と
 *    再現できず、**アプリからは永久に拾い直せない**（`src/main/pty/tmux.ts`）。
 *    claude は履歴から resume すれば同じセッションに戻れるので**止めない**
 *    （閉じるのは1日に何十回もある操作。確認は不可逆なものだけに絞る）。
 *
 * **この関数がその判定の唯一の正。** それまで判定は `App.tsx` の
 * `requestCloseTab` の中に直接書かれており、`Cmd+W`（`close-pane`）は
 * `closeActivePane` を直接呼ぶ別経路で**その判定を1度も通らなかった**（Issue #158）。
 * `Cmd+W` は `Cmd+Option+W` より押しやすく、実運用ではこちらが主要な経路になる。
 *
 * **`config.useTmux` を読み直さない。** ラップされたかは spawn の瞬間に決まり
 * `leaf.wrappedInTmux` が持っている。設定を後から切った人に、既に tmux で
 * 走っているペインについて嘘をつかないため。
 */
export function needsCloseConfirmation(closingLeaves: readonly PaneLeaf[]): boolean {
  if (closingLeaves.length >= 2) return true;
  return summarizeClosingPanes(closingLeaves).persistentOrphaned > 0;
}
