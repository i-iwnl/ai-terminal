import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;
let server: Server | undefined;

/** Webhook として受け取ったリクエストの本文（JSON をパースしたもの）。 */
let received: Array<Record<string, unknown>> = [];

/**
 * 受信用の HTTP サーバを 127.0.0.1 の空きポートで立て、URL を返す。
 * Slack / Discord の Incoming Webhook の代わりとして使う。
 */
async function startWebhookServer(): Promise<string> {
  received = [];
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += String(chunk);
    });
    req.on('end', () => {
      try {
        received.push(JSON.parse(body) as Record<string, unknown>);
      } catch {
        received.push({ __unparsed: body });
      }
      // Discord は成功時に 204 を返す。本文なしでも成功と判定できることの確認も兼ねる。
      res.writeHead(204).end();
    });
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const address = server?.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}/webhook`;
}

test.afterEach(async () => {
  await closeApp(launched);
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
  });
  server = undefined;
});

/**
 * 設定パネルで入力した Webhook URL に、テスト送信が実際に届くことを検証する。
 *
 * 「送信しました」の表示だけを見ると、Main が何も送らずに ok を返していても
 * 緑になる。ローカルに受信サーバを立て、**HTTP リクエストが届き、本文が
 * Slack / Discord それぞれの形（text / content）になっている**ことまで確認する。
 *
 * URL は入力欄の値をそのまま使う（保存前に試せる仕様）。設定の保存経路とは
 * 独立しているため、ここでは保存を待たずに送信できることも同時に担保される。
 */
test('S32 設定した Webhook にテスト送信が届く', async () => {
  const url = await startWebhookServer();
  launched = await launchApp();
  const { window } = launched;

  await window.locator('button[aria-label="設定を開く"]').click();
  const dialog = window.locator('[role="dialog"][aria-label="設定"]');
  await expect(dialog).toBeVisible();

  // Slack 側に受信サーバの URL を入れる
  const slackUrl = dialog.locator('input[aria-label="Slack の Webhook URL"]');
  const slackTest = dialog.locator('.settings__webhook').first().locator('button');

  // URL が空のうちはテスト送信を押せない（誤って空送信しないこと）
  await expect(slackTest).toBeDisabled();

  await slackUrl.fill(url);
  await expect(slackTest).toBeEnabled();
  await slackTest.click();

  await expect(dialog.locator('.settings__status').first()).toHaveText('送信しました', {
    timeout: 20_000,
  });

  // 実際に届いていること。Slack は text キー。
  expect(received).toHaveLength(1);
  expect(typeof received[0].text).toBe('string');
  expect(received[0].content).toBeUndefined();

  // Discord 側は content キーになる
  const discordUrl = dialog.locator('input[aria-label="Discord の Webhook URL"]');
  await discordUrl.fill(url);
  await dialog.locator('.settings__webhook').nth(1).locator('button').click();
  await expect(dialog.locator('.settings__webhook').nth(1).locator('.settings__status')).toHaveText(
    '送信しました',
    { timeout: 20_000 },
  );

  expect(received).toHaveLength(2);
  expect(typeof received[1].content).toBe('string');
  expect(received[1].text).toBeUndefined();

  // 届かない URL では失敗が表示される（成功と区別が付くこと）。
  // 到達不能なポートを指定して名前解決ではなく接続失敗にする。
  await slackUrl.fill('http://127.0.0.1:1/webhook');
  await slackTest.click();
  await expect(dialog.locator('.settings__status').first()).toContainText('失敗', {
    timeout: 20_000,
  });
});
