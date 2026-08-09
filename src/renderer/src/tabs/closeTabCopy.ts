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

/**
 * **その「閉じる」で AI をどうするつもりか**（Issue #244）。
 *
 * ⭐ **これが分類（`ClosingPaneSummary`）と別に要る理由。**
 * `Cmd+W` と メニュー「AI を残してタブを閉じる」は、**まったく同じペインの構成に対して
 * 違う結果を出す**。つまり結果は木の中身だけでは決まらない。
 * 意図を渡さないと、`closedTabChannel()` のような「唯一の正」であるはずの関数が
 * **意味の違う2つの操作に同じ面を返す**ことになる。
 *
 * ⛔ **呼び出し側に `if` を書いて回避しないこと。** 判定が2箇所になると、
 * 片方だけ直したときに「両方に流す」「どちらにも流さない」が静かに生まれる。
 *
 * ⚠ **`summarizeClosingPanes()` には渡さない。** あちらは「そのペインが**何であるか**」を
 * 数える関数で、意図とは独立。混ぜると `'terminate'` のときにプロバイダの内訳が
 * 失われ、「Claude 1 件を終了しました」と言えなくなる。
 */
export type CloseIntent =
  /** 通常の「閉じる」。tmux セッションごと終了する（`Cmd+W` / `Cmd+Option+W` / タブバーの x）。 */
  | 'terminate'
  /** メニュー「AI を残してタブを閉じる」。従来どおり生き残る。 */
  | 'keep';

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
  return `${parts.join('と')}はサイドバーの「履歴」から再開できます。${HISTORY_HOPS}`;
}

/**
 * 履歴パネルに辿り着くまでの**追加の一手**。
 *
 * ⭐ **「履歴から再開できます」だけでは一手足りない**（design-rules 節6）。
 * 履歴パネルには既定が2つあり、**どちらも外れうる**:
 *
 * | 軸 | 既定 | 外れる人 |
 * |---|---|---|
 * | プロバイダのトグル | **Claude** | Gemini を閉じた人 |
 * | フォルダの絞り込み | **このフォルダ** | 別のフォルダで動かしていた人 |
 *
 * 2つ目は design-review の IA が指摘した（2026-08-09）。1つ目だけ言っていたので、
 * **プロバイダを合わせても空の一覧を見る人が残っていた**。
 *
 * ⚠ 「すべてのフォルダを見る」は `HistoryList.tsx` の実装上 **Claude のときだけ出る**。
 * それでも文言では言い分けない（分けると文が倍になり、読み上げが長くなりすぎる）。
 */
const HISTORY_HOPS =
  '履歴はプロバイダごとに分かれているので、パネル上部で切り替えてください。別のフォルダで動かしていたものは「すべてのフォルダを見る」を押してください。';

/**
 * 終了したときの「会話は残っている」の1文（Issue #244）。
 *
 * ⭐ **「不可逆」は言い過ぎ**（design-review の a11y / macOS が独立に指摘）。
 * tmux セッションを終了しても `~/.claude/projects/*.jsonl` は残るので、
 * `claude --resume` で**会話は戻る**。失われるのは**実行中の作業**だけ。
 * この区別を告知に書くのが、Undo を作るよりも正しい（戻らないものを
 * 「戻せます」と約束しない）。
 */
function buildTerminatedResumeNote(summary: ClosingPaneSummary): string {
  if (summary.persistentResumable === 0) return '';
  const parts = PROVIDER_ORDER.filter((kind) => (summary.resumableByProvider[kind] ?? 0) > 0).map(
    (kind) => `${providerLabel(kind)} ${summary.resumableByProvider[kind] ?? 0} 件`,
  );
  const who = parts.length === 0 ? `${summary.persistentResumable} 件` : parts.join('と');
  return `${who}の会話はサイドバーの「履歴」に残っているので、続きから再開できます。${HISTORY_HOPS}`;
}

/**
 * 内訳から文言を決める。
 *
 * 文言の原則（design-review の5ペルソナレビューより）:
 * - **結果を先、機構を後。** 読み上げは中断できないので、最初の数文字で行動が決まる
 * - **「tmux」を主語にしない。** ユーザーが有効にしたのは設定の項目名であって tmux ではない
 * - **何も終了しないのに「終了する」と言わない。** ボタンのラベルも結果に合わせる
 */
export function closeTabCopy(summary: ClosingPaneSummary, intent: CloseIntent): CloseTabCopy {
  const persistent = summary.persistentResumable + summary.persistentOrphaned;

  // ⭐ **通常の「閉じる」は、tmux でラップされていようがいまいが全部終了する**（Issue #244）。
  // 直す前はここが `persistent === 0` の分岐に落ちず、「AI の作業は続きます」と
  // **事実と逆のことを言っていた**。
  if (intent === 'terminate') {
    const total = summary.exiting + persistent;
    return {
      title: `走行中のプロセス ${total} 件を終了します`,
      body: [
        `このタブを閉じると、中で動いている ${total} 件のプロセスがすべて終了します。`,
        buildTerminatedResumeNote(summary),
      ]
        .filter(Boolean)
        .join(''),
      confirmLabel: '終了する',
    };
  }

  // 以下は `intent === 'keep'`（メニュー「AI を残してタブを閉じる」）。

  // 従来どおりの経路（tmux でラップされたペインが1つも無い）。
  // **ここは characterization**（いまそうなっている文言をそのまま固定する）。
  // 残すつもりでも、残せるものが1つも無ければ結果は終了と同じ。
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
 * どちらへ流すかは `closedTabChannel()` が決める。呼び出し側で分岐を書かないこと。
 */
export function closedTabAnnouncement(
  summary: ClosingPaneSummary,
  intent: CloseIntent,
): string {
  const persistent = summary.persistentResumable + summary.persistentOrphaned;

  // ⭐ **通常の「閉じる」は AI も終了する**（Issue #244）。
  //
  // ⛔ **ここを「何も告知しない」にしない**（design-review で5人全員が反対した唯一の項目）。
  // 初版の案は「意図どおりの結果に事後報告は要らない」として `announce` ごと消そうとしたが、
  // それは**支援技術利用者から、現在ある唯一のフィードバックを奪う**。
  // 晴眼利用者は「タブが消えた」を目で確認できるが、その『眺める』が無い人がいる。
  // しかもターミナルの中身は既定構成では支援技術に原理的に届いていない
  // （`TaskList.tsx` 冒頭）ので、**この1文が操作が成立した唯一の証拠**になる。
  //
  // 節8 の表の答えは「`announce` **だけでよい**」であって「出さなくてよい」ではない。
  if (intent === 'terminate') {
    if (persistent === 0) return 'タブを閉じました';
    return [
      `タブを閉じました。AI の作業 ${persistent} 件を終了しました。`,
      buildTerminatedResumeNote(summary),
    ]
      .filter(Boolean)
      .join('');
  }

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

/** `closedTabAnnouncement()` の文を、どの面へ流すか。 */
export type ClosedTabChannel =
  /** 視覚的な通知バナー（`.notice-list`）。error が無ければ `role="status"` なので読み上げも届く。 */
  | 'notice'
  /** 視覚的に隠された live region（`.app-status`）。目で見れば分かることだけをここへ流す。 */
  | 'announce';

/**
 * 閉じたことの告知を、通知バナーと live region のどちらへ流すか。
 *
 * ⭐ **これが無いと、視覚利用者にだけ情報が届かない状態になる。**
 * 確認ダイアログを外したとき（Issue #155）、受け皿として `closedTabAnnouncement()` を
 * 作って `announce()` に流した。ところが `.app-status` は `clip: rect(0,0,0,0)` で
 * **画面から隠されている**ので、「タブを閉じても AI は走り続けている」という、
 * この操作でいちばん驚く事実が**支援技術利用者にしか届いていなかった**。
 *
 * Issue #155 の設計メモが心配していた非対称（「得をするのが晴眼キーボード利用者だけ」）が、
 * **ちょうど裏返しの形で実現していた**。design-review で5人中4人が独立に指摘した
 * （2026-08-07）。
 *
 * 分け方:
 *
 * - **走り続けているものがある** -> `notice`。目で見えないと気づけない事実なので、
 *   視覚面に出す。`.notice-list` は error が無ければ `role="status"` なので、
 *   **同じ文がバナーと読み上げの両方に1回ずつ**届く（2回読まれない）
 * - **何も残らない** -> `announce`。タブが消えたことは目で見れば分かるので、
 *   バナーを出すとただの雑音になる。読み上げにだけ残す
 *
 * ⛔ **呼び出し側で `persistent > 0` を書き直さないこと。** 判定が2箇所になると、
 * 片方だけ直したときに「両方に流す」「どちらにも流さない」が静かに生まれる。
 *
 * ⭐ **`intent` が要る理由**（Issue #244）。同じペイン構成でも、通常の「閉じる」と
 * 「AI を残して閉じる」では**残るものが違う**。`summary` だけを見ていると、
 * 意味の違う2つの操作に同じ面を返してしまう。
 *
 * | 操作 | 目で見て分かるか | 面 |
 * |---|---|---|
 * | 通常の「閉じる」 | **タブが消えたのは分かる**（結果も意図どおり） | `announce` |
 * | 「AI を残して閉じる」 | **残ったことは見えない** | `notice` |
 */
export function closedTabChannel(
  summary: ClosingPaneSummary,
  intent: CloseIntent,
): ClosedTabChannel {
  if (intent === 'terminate') return 'announce';
  return summary.persistentResumable + summary.persistentOrphaned > 0 ? 'notice' : 'announce';
}

/**
 * **確認ダイアログを出すべきか**（Issue #121 周5 / #158）。
 *
 * 引数は「その操作で**実際に閉じる**ペイン」。タブごと閉じるなら木の全 leaf、
 * ペイン1枚を閉じるならその1枚。
 *
 * 判定は2つ:
 *
 * 1. **2本以上を一度に閉じる**（タブバーの x ボタンがマウス経由の抜け穴に
 *    ならないようにする）
 * 2. **`intent === 'keep'` で、1本でも回収できなくなるものがある**（`persistentOrphaned > 0`）。
 *    tmux でラップされたのに `agentSessionId` を持たないペインは、残すと
 *    tmux セッション名を二度と再現できず、**アプリからは永久に拾い直せない**
 *    （`src/main/pty/tmux.ts`）。
 *
 * ⭐ **2 が `'keep'` 限定になったのが Issue #244 の変更点。**
 * 通常の「閉じる」ではセッションごと終了させるので、**「拾えないプロセスが残る」
 * という事故が原理的に起きない**（名前は `buildTmuxSessionName(agentSessionId ?? ptyId)` で
 * 確定しており、Main がそれを保持しているので orphan でも確実に終了できる）。
 * ⛔ **条件を消したのではなく、まだ成り立つ側へ移した。** 残す操作では理由がそのまま生きている。
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
export function needsCloseConfirmation(
  closingLeaves: readonly PaneLeaf[],
  intent: CloseIntent,
): boolean {
  if (closingLeaves.length >= 2) return true;
  if (intent === 'terminate') return false;
  return summarizeClosingPanes(closingLeaves).persistentOrphaned > 0;
}
