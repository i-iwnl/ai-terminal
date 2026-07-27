// PTY 出力の取りこぼしを防ぐためのハブ。
//
// タブを開くとき、Renderer は `pty:spawn` の解決を待ってからタブを追加し、
// その後にマウントされる TerminalPane が初めて出力を購読する。
// 一方 Main 側の PTY は spawn 直後から出力を流し始めるため、
// この間に届いたデータは購読者がおらず、そのまま失われていた。
//
// 実害: claude / gemini を起動した直後の1回きりのバナー（起動メッセージや
// 最初のプロンプト）が消え、ターミナルが空のまま何も起きないように見える。
//
// そこでアプリ起動時にハブを1つだけ立て、購読者がまだいない ptyId の出力は
// バッファに溜めておき、購読が始まった時点で順序どおり流し込む。

import type { PtyDataEvent, PtyExitEvent } from '@shared/ipc';

type DataListener = (data: string) => void;
type ExitListener = (event: PtyExitEvent) => void;

const pendingData = new Map<string, string[]>();
const pendingExit = new Map<string, PtyExitEvent>();
const dataListeners = new Map<string, DataListener>();
const exitListeners = new Map<string, ExitListener>();

let started = false;

/**
 * ハブを起動する。**最初の pty:spawn より前に呼ぶこと。**
 * 二重に呼んでも無害。
 */
export function startPtyStream(): void {
  if (started) return;
  started = true;

  window.api.pty.onData((event: PtyDataEvent) => {
    const listener = dataListeners.get(event.ptyId);
    if (listener) {
      listener(event.data);
      return;
    }
    const buffered = pendingData.get(event.ptyId);
    if (buffered) {
      buffered.push(event.data);
    } else {
      pendingData.set(event.ptyId, [event.data]);
    }
  });

  window.api.pty.onExit((event: PtyExitEvent) => {
    const listener = exitListeners.get(event.ptyId);
    if (listener) {
      listener(event);
      return;
    }
    pendingExit.set(event.ptyId, event);
  });
}

/**
 * 指定した PTY の出力を購読する。
 * 購読前に届いていた分があれば、到着順のままフラッシュしてから購読を開始する。
 * 戻り値は購読解除関数。
 */
export function subscribePty(
  ptyId: string,
  onData: DataListener,
  onExit: ExitListener,
): () => void {
  startPtyStream();

  dataListeners.set(ptyId, onData);
  exitListeners.set(ptyId, onExit);

  const buffered = pendingData.get(ptyId);
  if (buffered) {
    pendingData.delete(ptyId);
    for (const chunk of buffered) onData(chunk);
  }

  const exited = pendingExit.get(ptyId);
  if (exited) {
    pendingExit.delete(ptyId);
    onExit(exited);
  }

  return () => {
    dataListeners.delete(ptyId);
    exitListeners.delete(ptyId);
  };
}

/** タブを閉じたときに、溜まったままの分を破棄する。 */
export function forgetPty(ptyId: string): void {
  pendingData.delete(ptyId);
  pendingExit.delete(ptyId);
}
