import { test, expect } from '@playwright/test';
import { launchApp, closeApp, setAgentEntries, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

/** 正規表現の特殊文字をエスケープする（他 spec と同じ理由） */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Issue #132。**`Cmd+J` が「あなたの番」の**ペイン**まで着地すること。**
 *
 * それまで `findNextYourTurnTab` は tabId しか返しておらず、呼び出し側は
 * `setActiveTabId` しかできなかった。分割しているタブでは**タブが前に出ても
 * アクティブなペインは前のまま**なので、待っている claude が裏のペインに居ると
 * 飛んだ先で入力できない（タブ止まり）。
 *
 * **「このハーネスでは成功経路を作れない」という注記は古かった。**
 * S68 / S78 / S63 と `scenarios.yml` の4箇所が「偽 CLI の `agents.json` の
 * sessionId は、アプリが実際に起動するセッションの agentSessionId と独立している。
 * 解くのは Issue #83」と書いていたが、**#83 は CLOSED で `setAgentEntries()` は
 * 実装済み**だった。S63 が使う「履歴 resume なら agentSessionId を決め打てる」
 * 手法と組み合わせれば、**両者が一致する実タブを作れる**。この spec がその実例。
 *
 * 作る状況:
 *
 * 1. 履歴から resume して claude タブ（tab2）を開く -> `agentSessionId` は既知の固定 UUID
 * 2. tab2 を分割する -> 左が claude、右が新しいシェル（**右がアクティブ**）
 * 3. `setAgentEntries()` でその UUID を `idle`（= あなたの番）として流す
 * 4. tab1（シェルタブ）へ戻る -> ジャンプ先が「別のタブ」になる
 * 5. `Cmd+J`
 *
 * **判定は「claude の**ペイン**が is-active になること」。**
 * タブ粒度のままだと tab2 は前に出るが、アクティブなペインは手順2で作った
 * シェル側のままなので、この assert が赤くなる。
 */
test('S89 Cmd+J が、分割したタブの裏で待っている claude のペインまで着地する', async () => {
  const { window, workDir } = launched;
  const cwdName = workDir.split('/').pop() as string;
  const promptPattern = new RegExp(`${escapeRegExp(cwdName)}\\s*[%#]`);
  // S63 / S19 と同じ、履歴フィクスチャ「サイドバーのレイアウト修正」の固定 UUID。
  // resume 起動は `--resume` に渡した ID をそのまま `agentSessionId` に返す。
  const RESUME_SESSION_ID = '11111111-1111-4111-8111-111111111111';

  const tabs = window.locator('.tab-bar__tab');
  const visiblePanes = window.locator('.terminal-pane:not(.terminal-pane--hidden)');
  const activePane = window.locator('.terminal-pane.is-active');

  await expect(tabs).toHaveCount(1, { timeout: 15_000 });
  await expect(activePane.locator('.xterm-screen')).toContainText(promptPattern, {
    timeout: 20_000,
  });

  // --- 1. 履歴から resume して claude タブを開く -------------------------------
  await window.locator('.sidebar__tabs button', { hasText: '履歴' }).click();
  const historyEntry = window.locator('.history-item', { hasText: 'サイドバーのレイアウト修正' });
  await expect(historyEntry).toHaveCount(1);
  await historyEntry.click();

  await expect(tabs).toHaveCount(2);
  await expect(activePane.locator('.xterm-screen')).toContainText(RESUME_SESSION_ID, {
    timeout: 20_000,
  });

  // --- 2. 分割する: 左が claude、右が新しいシェル（右がアクティブ）--------------
  await window.keyboard.press('Meta+d');
  await expect(visiblePanes).toHaveCount(2);
  const claudePane = visiblePanes.first();
  const shellPane = visiblePanes.last();
  await expect(shellPane).toHaveClass(/is-active/);
  await expect(claudePane).not.toHaveClass(/is-active/);
  await expect(shellPane.locator('.xterm-screen')).toContainText(promptPattern, {
    timeout: 20_000,
  });

  // --- 3. その claude を「あなたの番」にする ------------------------------------
  //
  // **アプリが実際に起動したセッションの UUID を、偽 CLI の出力へ書き戻す。**
  // これが「成功経路を作れない」を解いている部分。
  setAgentEntries(launched, [
    {
      pid: 4242,
      cwd: workDir,
      kind: 'claude',
      startedAt: Date.now() - 3_600_000,
      sessionId: RESUME_SESSION_ID,
      name: 'サイドバーのレイアウト修正',
      status: 'idle',
    },
  ]);

  // ポーリングが拾うまで待つ。**タブバーの状態スロットで観測する**
  // （サイドバーの一覧ではなく、Cmd+J と同じ `yourTurnSessionIds` を通る側）。
  await expect(window.locator('.tab-bar__state-slot--your-turn')).toHaveCount(1, {
    timeout: 20_000,
  });

  // --- 4. 1枚目のシェルタブへ戻る ----------------------------------------------
  await window.keyboard.press('Meta+1');
  await expect(tabs.nth(0)).toHaveClass(/is-active/);

  // --- 5. Cmd+J --------------------------------------------------------------
  await window.keyboard.press('Meta+j');

  // **タブが切り替わるだけでは足りない。** 待っている claude の**ペイン**が
  // アクティブになっていること。ここがタブ粒度の実装で赤くなる。
  await expect(tabs.nth(1)).toHaveClass(/is-active/, { timeout: 10_000 });
  await expect(window.locator('.terminal-pane:not(.terminal-pane--hidden)').first()).toHaveClass(
    /is-active/,
    { timeout: 10_000 },
  );
  await expect(window.locator('.terminal-pane:not(.terminal-pane--hidden)').last()).not.toHaveClass(
    /is-active/,
  );

  // **「あなたの番のタブはありません」が出ていないこと。**
  // 探索が空振りしたまま「タブだけ切り替わった」ように見える壊れ方を防ぐ。
  await expect(
    window.locator('.notice-banner', { hasText: 'あなたの番のタブはありません' }),
  ).toHaveCount(0);
});
