import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

/**
 * Issue #20 J: `Cmd+J`（次の「あなたの番」のタブへジャンプ）。
 *
 * **このハーネスでは「実際にジャンプが成功するケース」までは検証できない。**
 * `claude agents --json` を模す偽 CLI のフィクスチャ（harness.ts の agents.json、
 * sessionId は `aaaaaaaa...` / `bbbbbbbb...` 固定）は、アプリが実際に起動する
 * セッションの agentSessionId（新規は起動時に生成される UUID、resume は
 * 履歴 JSONL 側の固定 UUID）とは独立しており、両者が一致する実タブを
 * このフィクスチャ構成では作れない（S15 / S63 が既に記録済みの同じ制限。
 * Issue #83 でハーネスの動的フィクスチャ化が解く予定）。
 * 探索そのもの（`findNextYourTurnTab`）は test/unit/tab-your-turn.test.ts が
 * 固定しており、実装の中核を revert すると赤くなることを実測済み。
 *
 * ここで検証するのは「あなたの番のタブが1つも無いときに何も起きないまま
 * 終わらせない」side（Issue #56 U4 と同じ教訓）。起動直後はシェルタブ1枚のみで
 * agentSessionId を持つタブが無く、これは確実に「あなたの番のタブが無い」状態。
 */
test('S68 「あなたの番」のタブが無いときに Cmd+J を押しても、通知で分かる', async () => {
  const { window } = launched;

  // **最初のシェルタブが出るまで待つ。** マウント前に押したキーは
  // グローバルショートカットの keydown リスナ（App.tsx の useEffect）に
  // 拾われず取りこぼされる（S55 と同じ前例）。
  await expect(window.locator('.tab-bar__tab')).toHaveCount(1, { timeout: 15_000 });

  await window.keyboard.press('Meta+j');
  await expect(window.locator('.notice-banner')).toContainText('あなたの番のタブはありません', {
    timeout: 5_000,
  });
  await expect(window.locator('.app-status')).toContainText('あなたの番のタブはありません');

  // Shift 付き（逆順）でも同じ経路を通ることを見る。
  await window.keyboard.press('Meta+Shift+J');
  await expect(window.locator('.app-status')).toContainText('あなたの番のタブはありません');
});
