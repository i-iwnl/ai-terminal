// タスク完了通知。macOS 通知 ＋ 通知音 ＋ Slack / Discord への転送。
//
// 通知の経路は3つあるが、どれか1つが失敗しても他は出す。
// 「音源が消えていたので通知も出なかった」のような連鎖を作らない。

import { ipcMain, Notification } from 'electron';

import {
  IpcInvoke,
  type NotifyRequest,
  type PlaySoundRequest,
  type SoundOption,
  type TestWebhookRequest,
  type WebhookSendResult,
  type WebhookTarget,
} from '@shared/ipc';
import { getConfig } from '../config';
import { listSounds, playSound, DEFAULT_SOUND_ID } from './sound';
import { sendWebhook } from './webhook';

/**
 * 通知を出す。
 *
 * - Notification.isSupported() が false の環境では OS 通知だけを飛ばす（音と Webhook は出す）。
 * - sound が省略された場合は設定（notifySound）に従う。
 * - 通知音を自前で指定している場合は Notification を silent にして afplay で鳴らす。
 *   Notification 側の音と二重に鳴らさないため。
 * - Slack / Discord への送信は完了を待たない（外部 HTTP で通知が遅れないように）。
 *
 * poller.ts からタスク完了検知時に直接呼べるよう export する。
 */
export function notify(req: NotifyRequest): void {
  const config = getConfig();
  const soundEnabled = req.sound ?? config.notifySound;
  const customSoundId = soundEnabled ? config.notifySoundId : DEFAULT_SOUND_ID;
  // 自前で鳴らす音がある場合だけ OS の通知音を止める。
  // 「OS 既定」を選んでいるときは Notification に任せる（silent にしない）。
  const useCustomSound = customSoundId !== DEFAULT_SOUND_ID;

  if (Notification.isSupported()) {
    const notification = new Notification({
      title: req.title,
      body: req.body,
      silent: !soundEnabled || useCustomSound,
    });
    notification.show();
  }

  if (useCustomSound) {
    playSound(customSoundId);
  }

  for (const target of ['slack', 'discord'] as const) {
    const webhook = config[target];
    if (!webhook.enabled || webhook.url.length === 0) continue;
    void sendWebhook(target, webhook.url, req.title, req.body).then((result) => {
      if (!result.ok) {
        console.warn(`[notify] ${target} への送信に失敗しました:`, result.error);
      }
    });
  }
}

/** IPC 境界を越えた値を信用せず、送信先として妥当か判定する。 */
function isWebhookTarget(value: unknown): value is WebhookTarget {
  return value === 'slack' || value === 'discord';
}

/**
 * 通知関連の IPC ハンドラを登録する。
 */
export function registerNotifyHandlers(): void {
  ipcMain.handle(IpcInvoke.notifyShow, (_event, req: NotifyRequest): void => {
    notify(req);
  });

  ipcMain.handle(IpcInvoke.notifyListSounds, (): SoundOption[] => listSounds());

  ipcMain.handle(IpcInvoke.notifyPlaySound, (_event, rawReq: unknown): void => {
    const req = (rawReq ?? {}) as PlaySoundRequest;
    const soundId = typeof req.soundId === 'string' ? req.soundId : getConfig().notifySoundId;
    playSound(soundId);
  });

  ipcMain.handle(
    IpcInvoke.notifyTestWebhook,
    async (_event, rawReq: unknown): Promise<WebhookSendResult> => {
      if (typeof rawReq !== 'object' || rawReq === null) {
        return { ok: false, error: '不正なリクエストです' };
      }
      const req = rawReq as TestWebhookRequest;
      if (!isWebhookTarget(req.target)) {
        return { ok: false, error: '不正な送信先です' };
      }
      // 保存前の入力値で試せるよう、リクエストの URL を優先する。
      const url = typeof req.url === 'string' && req.url.length > 0 ? req.url : getConfig()[req.target].url;
      if (url.length === 0) {
        return { ok: false, error: 'Webhook URL が設定されていません' };
      }
      return sendWebhook(req.target, url, 'ai-terminal のテスト通知', 'この通知が届けば設定は正しく動いています。');
    },
  );
}
