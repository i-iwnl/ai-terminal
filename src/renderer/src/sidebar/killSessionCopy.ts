// タスク一覧の行から AI セッションを終了する前の確認ダイアログの文言（Issue #244 周6-a）。
//
// **`closeTabCopy.ts` に足さない理由。** あちらは「タブを閉じる」の文言の正で、
// ペインの木の中身（tmux ラップの有無・プロバイダ内訳・混在の有無）から複数パターンの
// 文言を組み立てる。一覧からの終了は常に「1件」かつ「呼び出し側（App.tsx）が
// `toTaskState() === 'working'` を確認済みのときにしか出さない」ため、分岐そのものが
// 要らない。無理に相乗りさせると、「タブを閉じる」の意味と混線する
// （closeTabCopy.ts 冒頭の「⛔ ここに書き写さない」規律と同じ考え方）。
//
// ダイアログ自体は既存の `CloseTabConfirmDialog`（`CloseTabCopy` を受け取って描くだけの
// コンポーネント）をそのまま再利用する。⛔ 新しいダイアログ実装を起こさない
// （e2e/specs/S114-list-row-terminate-busy-confirm.spec.ts が
// `.confirm-dialog__button--danger` をセレクタに使っている）。
//
// 文言の作法は `closeTabCopy.ts` 冒頭のコメントと同じ:
// - **`tmux` を主語にしない。** ユーザーが有効にしたのは設定の項目名であって tmux ではない
// - **「取り消せます」と言わない。何が戻らないかを言う。** 会話は `claude --resume` で
//   戻るが、実行中の作業は戻らない
//
// ⭐ **E2E（S114）が本文に「作業中」「やり直しになります」の2語を逐語で検査している。**
// 削る・言い換えるときはそちらも見ること。

import type { CloseTabCopy } from '../tabs/closeTabCopy';

/**
 * タスク一覧の行から、いま作業中の AI を終了する前の確認文言。
 *
 * **呼び出し条件（busy かどうか）は App.tsx 側で確定済み。** ここでは分岐しない
 * — busy でない行はそもそもこの関数を呼ばず、確認なしで終了する
 * （周4 で確定した「確認の頻度は損失の重さに比例する」の適用。理由の全文は
 * `closeTabCopy.ts` の `needsCloseConfirmation` 冒頭コメント参照）。
 */
export function killSessionCopy(): CloseTabCopy {
  return {
    title: '作業中の AI を終了します',
    body: 'この AI はいま作業中です。終了すると、途中まで進んだ作業はやり直しになります。',
    confirmLabel: '終了する',
  };
}
