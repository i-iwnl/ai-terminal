// Slack / Discord への Webhook 送信で組み立てるペイロードと URL の妥当性判定。
//
// 「Slack は text、Discord は content」という外部仕様の差はここだけが知っている。
// 取り違えると片方に何も届かないまま HTTP 200 が返るので、テストで固定する。

import { describe, expect, it } from 'vitest';
import { buildWebhookPayload, isValidWebhookUrl } from '../../src/main/notify/webhook';

describe('buildWebhookPayload', () => {
  it('Slack は text キーを使う', () => {
    expect(buildWebhookPayload('slack', '完了', 'demo-project')).toEqual({
      text: '完了\ndemo-project',
    });
  });

  it('Discord は content キーを使う', () => {
    expect(buildWebhookPayload('discord', '完了', 'demo-project')).toEqual({
      content: '完了\ndemo-project',
    });
  });

  it('本文が空ならタイトルだけを送る（余分な改行を付けない）', () => {
    expect(buildWebhookPayload('slack', '完了', '')).toEqual({ text: '完了' });
  });
});

describe('isValidWebhookUrl', () => {
  it('http / https を受け入れる', () => {
    expect(isValidWebhookUrl('https://hooks.slack.com/services/T/B/x')).toBe(true);
    expect(isValidWebhookUrl('https://discord.com/api/webhooks/1/x')).toBe(true);
    // 自前のエンドポイントを立てる構成もあるため、ホスト名は縛らない
    expect(isValidWebhookUrl('http://localhost:3000/hook')).toBe(true);
  });

  it('URL として解釈できない文字列を弾く', () => {
    expect(isValidWebhookUrl('')).toBe(false);
    expect(isValidWebhookUrl('hooks.slack.com/services/x')).toBe(false);
    expect(isValidWebhookUrl('あとで貼る')).toBe(false);
  });

  it('http / https 以外のスキームを弾く', () => {
    // 設定欄にローカルのパスを貼られてもファイルを読みに行かない
    expect(isValidWebhookUrl('file:///etc/passwd')).toBe(false);
    expect(isValidWebhookUrl('ftp://example.com/x')).toBe(false);
  });
});
