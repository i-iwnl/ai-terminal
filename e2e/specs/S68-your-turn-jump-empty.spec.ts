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
 * **成功するケースは `S89` が見る。** ここは「該当が1つも無い」側だけを担当する。
 *
 * **かつてここには「このハーネスでは成功経路を作れない（解くのは Issue #83）」と
 * 書いてあったが、それは古かった**（#160 の周6 で是正）。#83 は CLOSED で
 * `setAgentEntries()` は実装済み。S63 が使う「履歴 resume なら agentSessionId を
 * 決め打てる」手法と組み合わせれば、偽 CLI の出力とアプリが実際に起動した
 * セッションを一致させられる。**制約を書いたら、それを解く Issue の状態と
 * 紐づけて見直すこと**（`.claude/workspace/issue-160/known-issues.md` の 1）。
 *
 * 探索そのもの（`findNextYourTurnPane`）は test/unit/tab-your-turn.test.ts が
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
