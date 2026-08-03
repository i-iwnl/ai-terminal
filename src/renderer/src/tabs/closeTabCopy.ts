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
// **E2E ハーネスは `useTmux: false` 固定**なので、この分岐は E2E からは
// そのままでは踏めない。だから判定を純粋関数に切り出して `test/unit/` で固定する
// （このリポジトリの既定の作法。resizeGate / computeYourTurnSince / paneHeader 等と同じ形）。
//
// **claude と gemini は非対称**（src/main/pty/tmux.ts のコメントが唯一の正）。
// tmux セッション名は `buildTmuxSessionName(plan.agentSessionId ?? ptyId)` で決まり、
// `agentSessionId` を持つのは claude だけ（`buildClaudePlan`）。gemini は
// 起動のたびに使い捨てる ptyId に頼るしかないので、**閉じるとその名前を二度と
// 再現できない** = アプリからは回収できない。文言でここを混ぜてはいけない。

import type { PaneLeaf } from './paneTree';

/** 閉じようとしているタブの中身を、閉じた結果ごとに数えたもの。 */
export interface ClosingPaneSummary {
  /** 閉じると本当に終了する PTY の本数（tmux でラップされていないもの）。 */
  exiting: number;
  /** 閉じても動き続け、履歴から再開できるもの（tmux + claude）。 */
  persistentResumable: number;
  /** 閉じても動き続けるが、アプリからは二度と拾い直せないもの（tmux + gemini）。 */
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
  const summary: ClosingPaneSummary = { exiting: 0, persistentResumable: 0, persistentOrphaned: 0 };
  for (const leaf of leaves) {
    if (leaf.exit) continue;
    if (!leaf.wrappedInTmux) {
      summary.exiting += 1;
    } else if (leaf.ptyKind === 'claude') {
      summary.persistentResumable += 1;
    } else {
      // gemini（および将来ラップ対象が増えた場合）。shell は tmux ラップされない
      // （maybeWrapWithTmux が kind === 'shell' で早期 return する）ので、
      // ここに来るのは実質 gemini だけ。
      summary.persistentOrphaned += 1;
    }
  }
  return summary;
}

/** 設定パネル（SettingsPanel.tsx）に出ている語と揃える。別の言い回しを発明しない。 */
const PERSIST_SETTING_LABEL = 'アプリを閉じても AI の作業を続ける';

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

  const orphanNote =
    summary.persistentOrphaned > 0
      ? `そのうち ${summary.persistentOrphaned} 件（gemini）は、アプリから開き直す手段がありません。続けたい作業なら、このタブは閉じないでください。`
      : '';
  const resumeNote =
    summary.persistentResumable > 0
      ? `${summary.persistentResumable} 件（claude）はサイドバーの「履歴」から再開できます。`
      : '';

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
