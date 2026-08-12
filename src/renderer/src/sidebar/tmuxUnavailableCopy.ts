// タスクパネルに出す「押せない理由」の文言（Issue #244 周7）。
//
// **背景。** タスク一覧には「押せる行」と「押せない行」が混ざる。周5で押せる行の
// 左端に線を出したので**どれが押せるかは見える**ようになったが、**押せない理由は
// 画面のどこにも出ていなかった。** とくに困るのは異常時: 「アプリを閉じても AI の
// 作業を続ける」（`useTmux`）を有効にしているのに tmux が見つからないと、
// **全行が一斉に押せなくなる**。利用者にはアプリが壊れたようにしか見えない。
//
// ⛔ **行ごとに「アプリ外」「操作できません」のような語は出さない。**
// design-review（`.claude/workspace/issue-244/design-review/proposal-v2-after-review.md`
// §2-F'）で5/5が「提案 F はパネル単位。行ごとに同じ文を出さない」と決めている。
// 加えて `AgentTask.ownedByApp` は**Main のメモリ上の Set**で、アプリを再起動すると
// 空になる（`taskRow.ts` に明記）。行ごとに出すと、再起動直後は**全行に嘘の語が並ぶ**。
//
// ⛔ **`tmux` を主語にしない。** `closeTabCopy.ts` の `PERSIST_SETTING_LABEL` 冒頭と
// 同じ規約: 利用者が有効にしたのは設定の項目名であって tmux ではない。
// design-review の初版提案文（`「…」に必要な tmux が見つかりません`）はこの規約に
// 抵触する形で `tmux` という語をそのまま出していたため、**ここでは採らない**。
// 「必要なもの」という語だけで十分に次の行動（設定を開いて確認する）に繋がる。
//
// ⛔ **live region にしない。** ポーリングは3秒周期で、取得が揺れると鳴り続ける
// （`closedTabChannel()` が「目で見て分かることだけを announce へ」としているのと
// 同じ判断）。呼び出し側（TaskList.tsx）は通常の DOM テキストとして描画するだけでよい。
//
// **文言は既存の「Claude CLI が見つかりません」パネル（Issue #20 I-3）の書き方に揃える。**
// 見出しで結論、本文で次の行動、という構成。

import { PERSIST_SETTING_LABEL } from '../tabs/closeTabCopy';

/** タスクパネルに出す2行分の文言。 */
export interface TmuxUnavailableCopy {
  heading: string;
  body: string;
}

/**
 * 「設定は有効なのに tmux が使えない」パネルの文言を組み立てる。
 *
 * 呼び出し条件（`useTmux` が true かつ tmux が使えない）は Main 側
 * （`AgentTasksEvent.tmuxUnavailable`）が確定済みで、ここでは分岐しない。
 */
export function tmuxUnavailableCopy(): TmuxUnavailableCopy {
  return {
    heading: `「${PERSIST_SETTING_LABEL}」に必要なものが見つかりません`,
    body: '設定で確認してください。',
  };
}
