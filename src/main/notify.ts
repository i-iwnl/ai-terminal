// タスク完了通知（macOS 通知 ＋ 音）。

import { ipcMain, Notification } from 'electron';

import { IpcInvoke, type NotifyRequest } from '@shared/ipc';
import { getConfig } from './config';

/**
 * Electron の Notification で macOS 通知を出す。
 * - Notification.isSupported() が false の環境（対応していない OS 等）では黙って何もしない。
 * - sound が省略された場合は設定（notifySound）に従う。
 * poller.ts からタスク完了検知時に直接呼べるよう export する。
 */
export function notify(req: NotifyRequest): void {
  if (!Notification.isSupported()) return;

  const sound = req.sound ?? getConfig().notifySound;
  const notification = new Notification({
    title: req.title,
    body: req.body,
    silent: !sound,
  });
  notification.show();
}

/**
 * 通知関連の IPC ハンドラを登録する。
 */
export function registerNotifyHandlers(): void {
  ipcMain.handle(IpcInvoke.notifyShow, (_event, req: NotifyRequest): void => {
    notify(req);
  });
}
