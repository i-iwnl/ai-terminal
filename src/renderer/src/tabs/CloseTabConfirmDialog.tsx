// タブを閉じる前の確認ダイアログ（Issue #56 PR 8・design-review.md 提案 E'）。
//
// **いつ表示するかはこのファイルが決めない。** 判定の唯一の正は
// `closeTabCopy.ts` の `needsCloseConfirmation()` で、条件は2つ:
// (1) 2本以上を一度に閉じる、(2) 1本でも閉じると回収できなくなるものがある
// （tmux + gemini）。
//
// **かつてここには「2つ以上の PTY を一度に閉じるときだけ」と書いてあったが、
// それは古い。** (2) は Issue #121 の周5 で入り、`Cmd+W`（`close-pane`）が
// その判定を通るようになったのは Issue #158（#160 の周7）。
//
// 文言は「N 個のペインを閉じます」ではなく**「走行中のプロセス N 件を
// 終了します」**にする（design-review.md「何が失われるかの語」）。
// タブバーの x ボタン（TabBar.tsx の `.tab-bar__close`）も、`Cmd+Shift+W` を
// 新設していないマウス経由の抜け穴として同じ確認を通す。**`Cmd+W` が最後の
// 1枚を閉じる場合も同じ**（呼び出し側が `requestCloseTab` へ合流させる）。
//
// **Issue #121 A-3: 文言はこのファイルが決めない。** tmux でラップされた
// ペインは閉じても生き残るため、「すべて終了します」は既定構成では嘘になる
// （実測済み。closeTabCopy.ts のコメント参照）。何をどう言うかは
// `closeTabCopy()` が決め、ここは受け取った文字列を描くだけにする。

import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactElement } from 'react';

import type { CloseTabCopy } from './closeTabCopy';

export interface CloseTabConfirmDialogProps {
  /** `closeTabCopy()` が決めた文言（タイトル・本文・実行ボタンのラベル）。 */
  copy: CloseTabCopy;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function CloseTabConfirmDialog({
  copy,
  onConfirm,
  onCancel,
}: CloseTabConfirmDialogProps): ReactElement {
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  // 既定フォーカスは「キャンセル」（破壊的操作の既定を安全側に倒す。
  // 誤って Enter を押しても閉じない）。
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    // App.tsx のグローバル keydown（capture フェーズ）は matchShortcut が
    // 拾わないキー（Escape 含む）では preventDefault/stopPropagation しない
    // ため、ここまで届く。ダイアログを開いている間は Escape でキャンセル
    // できるようにする（モーダルの標準的な振る舞い）。
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCancel();
    }
  };

  return (
    <div
      className="confirm-dialog-overlay"
      // オーバーレイ自身（ダイアログの外側）をクリックしてもキャンセル扱いにする。
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-body"
        onKeyDown={handleKeyDown}
      >
        <h2 id="confirm-dialog-title" className="confirm-dialog__title">
          {copy.title}
        </h2>
        <p id="confirm-dialog-body" className="confirm-dialog__body">
          {copy.body}
        </p>
        <div className="confirm-dialog__actions">
          <button type="button" className="confirm-dialog__button" ref={cancelRef} onClick={onCancel}>
            キャンセル
          </button>
          <button
            type="button"
            className="confirm-dialog__button confirm-dialog__button--danger"
            onClick={onConfirm}
          >
            {copy.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
