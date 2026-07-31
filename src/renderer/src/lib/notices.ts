// 通知バナーの状態遷移を扱う純粋関数群。
//
// Issue #20 PR 11。従来 App.tsx は `useState<string | null>` の単一文字列で
// 通知を持っていたため、(1) 後から来た通知が前の通知を黙って消す、
// (2) 「タブを閉じました」と「PTY の起動に失敗しました」が同じ見た目、
// という2つの問題があった。ここでは「配列に何を足すか・どれを消すか・
// 上限を超えたらどうするか」というロジックだけを切り出し、
// React の再レンダーや DOM から独立してテストできるようにする
// （前例: terminal/resizeGate.ts, main/agents/yourTurnSince.ts）。

export type NoticeSeverity = 'error' | 'info';

export interface Notice {
  /** 個別に閉じるための識別子。生成方法はこのモジュールの関知しない（呼び出し側の責務）。 */
  id: string;
  message: string;
  severity: NoticeSeverity;
}

/**
 * 同時に保持する通知の上限。
 * 上限を設けない設計にすると、PTY の終了が連続したときに右上が画面を覆う。
 * 超えた分は古いものから捨て、直近 N 件だけを見せる。
 */
export const MAX_NOTICES = 5;

/**
 * PTY の終了イベントから通知の severity を決める。
 *
 * 正常終了（exitCode が 0 で、シグナルによる終了でもない）は「情報」、
 * それ以外（0 以外の終了コード、またはシグナルで終了）は「エラー」。
 * signal は 0 も「シグナル無し」を表しうる値として届くことがあるため、
 * `!== undefined && !== 0` で「実際にシグナルが立っている」ときだけ異常とみなす。
 */
export function severityForExit(event: { exitCode: number; signal?: number }): NoticeSeverity {
  const abnormal = event.exitCode !== 0 || (event.signal !== undefined && event.signal !== 0);
  return abnormal ? 'error' : 'info';
}

/**
 * 通知を1件追加する。
 * 上限（既定 MAX_NOTICES）を超えたら、超えた分だけ古いものから捨てる
 * （常に「直近 maxNotices 件」が残る）。
 */
export function pushNotice(
  notices: readonly Notice[],
  notice: Notice,
  maxNotices: number = MAX_NOTICES,
): Notice[] {
  const next = [...notices, notice];
  return next.length > maxNotices ? next.slice(next.length - maxNotices) : next;
}

/** id が一致する1件だけを取り除く。該当が無ければ元と同じ並びの新しい配列を返す。 */
export function dismissNotice(notices: readonly Notice[], id: string): Notice[] {
  return notices.filter((n) => n.id !== id);
}
