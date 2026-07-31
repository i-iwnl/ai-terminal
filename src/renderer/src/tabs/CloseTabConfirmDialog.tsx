// タブを閉じる前の確認ダイアログ（Issue #56 PR 8・design-review.md 提案 E'）。
//
// **2つ以上の PTY を一度に閉じるときだけ**呼び出し側（App.tsx）が表示する
// （1ペインのタブを閉じるのは、Cmd+W（closeActivePane）と同じく1本しか
// 巻き込まないため確認しない）。
//
// 文言は「N 個のペインを閉じます」ではなく**「走行中のプロセス N 件を
// 終了します」**にする（design-review.md「何が失われるかの語」）。
// タブバーの x ボタン（TabBar.tsx の `.tab-bar__close`）も、`Cmd+Shift+W` を
// 新設していないマウス経由の抜け穴として同じ確認を通す（呼び出し側で
// 同じ requestCloseTab を通せば自動的に揃う）。

import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactElement } from 'react';

export interface CloseTabConfirmDialogProps {
  /** このタブを閉じると失われる、走行中のプロセス（PTY）の本数。 */
  paneCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function CloseTabConfirmDialog({
  paneCount,
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
          走行中のプロセス {paneCount} 件を終了します
        </h2>
        <p id="confirm-dialog-body" className="confirm-dialog__body">
          このタブを閉じると、中で動いている {paneCount} 件のプロセスがすべて終了します。
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
            終了する
          </button>
        </div>
      </div>
    </div>
  );
}
