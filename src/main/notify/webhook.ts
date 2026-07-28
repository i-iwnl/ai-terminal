// Slack / Discord の Incoming Webhook への送信。
//
// 外部サービスへの HTTP は「失敗するのが普通」なので、送信の失敗で
// アプリを落とさない・通知そのものを止めないことを最優先にする。
// 呼び出し側（index.ts）は結果を待たずに投げっぱなしにしてよい。
//
// ペイロードの組み立ては純粋関数に切り出してある（Slack は text、Discord は content で
// キーが違うという知識をここ1箇所に閉じ込め、単体テストで固定する）。

import type { WebhookSendResult, WebhookTarget } from '@shared/ipc';

/** 応答を待つ上限。ここで待たされると通知全体が詰まるので短くする。 */
const TIMEOUT_MS = 5000;

/**
 * Webhook に送る JSON を組み立てる。
 * Slack は `text`、Discord は `content` がメッセージ本文のキー。
 */
export function buildWebhookPayload(
  target: WebhookTarget,
  title: string,
  body: string,
): Record<string, string> {
  // 改行で繋いだ1本の文字列にする。Slack / Discord とも本文中の改行をそのまま解釈する。
  const text = body.length > 0 ? `${title}\n${body}` : title;
  return target === 'slack' ? { text } : { content: text };
}

/**
 * Webhook URL として妥当か判定する。
 * ホスト名までは縛らない（Slack / Discord 互換のエンドポイントを自前で立てる構成もあるため）。
 * スキームだけを http / https に限定し、file: などを弾く。
 */
export function isValidWebhookUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

/**
 * Webhook に1件送る。
 *
 * 例外は投げず、必ず WebhookSendResult を返す。
 * Discord は成功時に 204（本文なし）、Slack は 200 を返すため、
 * 判定は「2xx かどうか」だけで行う。
 */
export async function sendWebhook(
  target: WebhookTarget,
  url: string,
  title: string,
  body: string,
): Promise<WebhookSendResult> {
  if (!isValidWebhookUrl(url)) {
    return { ok: false, error: 'Webhook URL の形式が不正です（http/https で始まる URL を指定してください）' };
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildWebhookPayload(target, title, body)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      // 応答本文にエラー理由が入ることが多い（Slack の "invalid_token" 等）ので拾う。
      // 長大な HTML が返ることもあるため切り詰める。
      const detail = await response.text().catch(() => '');
      const trimmed = detail.trim().slice(0, 200);
      return {
        ok: false,
        error: trimmed.length > 0 ? `HTTP ${response.status}: ${trimmed}` : `HTTP ${response.status}`,
      };
    }
    return { ok: true };
  } catch (err) {
    // タイムアウト（AbortError）・名前解決失敗・オフライン等はすべてここに来る。
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
