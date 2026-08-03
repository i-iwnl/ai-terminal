import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

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

/** OS 通知のクリックを模す。Main から Renderer へ session:focus を直接送る。 */
async function sendSessionFocus(app: LaunchedApp['app'], agentSessionId: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, sessionId) => {
    const win = BrowserWindow.getAllWindows()[0];
    win?.webContents.send('session:focus', sessionId);
  }, agentSessionId);
}

/**
 * Issue #56 PR 8: U4（design-review.md）「タスク一覧・通知の2経路をペイン粒度へ」。
 *
 * 初版の「タブを前に出す」（`setActiveTabId`）だけでは、対象ペインが今の
 * タブに既に見えている場合 no-op になり、通知をクリックしても画面が1pxも
 * 動かず壊れて見える問題を固定する。
 *
 * **なぜタスク一覧の行クリックではなく OS 通知（session:focus）から検証するか**:
 * `claude agents --json` はハーネスが固定した agents.json を返す偽 CLI で、
 * そこに含まれる sessionId はアプリがこれから起動するセッションの UUID とは
 * 独立している（S15 が既に記録済みの制限。動的に差し替えられるハーネスが無い）。
 * そのため「タスク一覧の行が実際に owned/clickable になる」ケースはこの
 * ハーネス構成では再現できない。一方 `session:focus`（OS 通知クリック）と
 * タスク一覧の行クリックは、どちらも App.tsx の同じ `focusPaneLocation`
 * （共通のペイン粒度解決）を通るため、`session:focus` を直接送ることで
 * 両方が共有するロジックを実際に検証できる。
 *
 * agentSessionId には、履歴の resume（`--resume`）で使う固定 UUID
 * （'サイドバーのレイアウト修正' エントリ、S19 と同じ）を使う。resume 起動は
 * `agentSessionId` に resume 先の ID をそのまま返す（`manager.ts`）ため、
 * 実際にアプリが起動したセッションの agentSessionId を確定的に用意できる
 * （claude 新規起動の `randomUUID()` と違い、テストから決め打てる）。
 */
test('S63 対象ペインが同じタブの非アクティブ側にあっても通知クリックでそのペインへフォーカスが移り、既にアクティブなら別の手がかりが出る', async () => {
  const { window, workDir } = launched;
  const cwdName = workDir.split('/').pop() as string;
  const promptPattern = new RegExp(`${escapeRegExp(cwdName)}\\s*[%#]`);
  const RESUME_SESSION_ID = '11111111-1111-4111-8111-111111111111';

  const tabs = window.locator('.tab-bar__tab');
  const visiblePanes = window.locator('.terminal-pane:not(.terminal-pane--hidden)');
  const activePane = window.locator('.terminal-pane.is-active');

  // --- 起動直後: シェルタブ1枚 -------------------------------------------------
  await expect(tabs).toHaveCount(1);
  await expect(activePane.locator('.xterm-screen')).toContainText(promptPattern, { timeout: 20_000 });

  // --- 履歴から resume: 新しいタブ（claude）が開き、アクティブになる ------------
  await window.locator('.sidebar__tabs button', { hasText: '履歴' }).click();
  const historyEntry = window.locator('.history-item', { hasText: 'サイドバーのレイアウト修正' });
  await expect(historyEntry).toHaveCount(1);
  await historyEntry.click();

  await expect(tabs).toHaveCount(2);
  const claudeTabTitle = await window
    .locator('.tab-bar__tab.is-active .tab-bar__title')
    .textContent();
  await expect(activePane.locator('.xterm-screen')).toContainText('FAKE CLAUDE READY', {
    timeout: 20_000,
  });
  await expect(activePane.locator('.xterm-screen')).toContainText(RESUME_SESSION_ID);

  // --- このタブを分割する: claude ペイン（左） + 新しいシェルペイン（右、アクティブ） ---
  await window.keyboard.press('Meta+d');
  await expect(visiblePanes).toHaveCount(2);
  await expect(tabs).toHaveCount(2); // 分割はタブを増やさない

  const claudePane = visiblePanes.first();
  const shellPane = visiblePanes.last();
  await expect(shellPane).toHaveClass(/is-active/);
  await expect(claudePane).not.toHaveClass(/is-active/);
  await expect(shellPane.locator('.xterm-screen')).toContainText(promptPattern, { timeout: 20_000 });

  // --- U4 の核心: 対象ペインは今のタブに既に見えているが、非アクティブ ----------
  // 「タブを前に出す」だけでは no-op になるはずの状況（タブは既にこれ）。
  await sendSessionFocus(launched.app, RESUME_SESSION_ID);

  // ペイン単位でフォーカスが移る: claude 側が is-active になる。
  await expect(claudePane).toHaveClass(/is-active/, { timeout: 5_000 });
  await expect(shellPane).not.toHaveClass(/is-active/);
  // タブ自体は増減も切り替わりもしていない（同じタブのままペインだけが動いた）。
  await expect(tabs).toHaveCount(2);
  await expect(window.locator('.tab-bar__tab.is-active .tab-bar__title')).toHaveText(
    claudeTabTitle ?? '',
  );

  // --- 対象ペインが既にアクティブな場合: 「何も起きない」で終わらせない ---------
  await sendSessionFocus(launched.app, RESUME_SESSION_ID);

  // 画面は変わらない(既にそのペインを見ている)が、何らかの手がかりが出る。
  // ここでは通知バナー（視覚）と role="status"（読み上げ）の両方で
  // 「既に表示されています」を伝える設計にした。
  await expect(window.locator('.notice-banner')).toContainText('は既に表示されています', {
    timeout: 5_000,
  });
  await expect(window.locator('.app-status')).toContainText('は既に表示されています');
  // アクティブなペインは変わらず claude 側のまま。
  await expect(claudePane).toHaveClass(/is-active/);

  // --- Issue #120 C-2（周4）: 対応するペインが1つも無い場合も無言で終わらせない ---
  //
  // 通知は `claude agents --json` のポーリングから作られ、`ownedByApp` で
  // 絞っていない（`scopeAgentsToCwd` の既定は false = マシン全体）ので、
  // **他のターミナルで起動した claude の完了通知が既定で飛ぶ**。それを押しても
  // このアプリには対応する leaf が無く、以前は黙って抜けていた。
  // 同じ空振りは tmux 永続化でタブだけ閉じた場合やアプリ再起動後にも起きる。
  //
  // ここでは「このアプリが一度も起動していない UUID」を送って再現する
  // （resume 用の固定 UUID とも、claude 新規起動の randomUUID() とも重ならない）。
  const UNKNOWN_SESSION_ID = '99999999-9999-4999-8999-999999999999';
  await sendSessionFocus(launched.app, UNKNOWN_SESSION_ID);

  // 1つ前の「既に表示されています」のバナーがまだ残っているので、
  // `.notice-banner` だけだと strict mode 違反になる。文言で絞る
  // （残っていること自体は仕様どおり。lib/notices.ts が上限まで積む）。
  await expect(
    window.locator('.notice-banner', { hasText: 'このセッションを開いているタブはありません' }),
  ).toHaveCount(1, { timeout: 5_000 });
  await expect(window.locator('.app-status')).toContainText(
    'このセッションを開いているタブはありません',
  );
  // 見つからなかったのだから、タブもペインも動かしてはいけない
  // （「何か起きたように見せる」ために別のペインへ移すと、それは嘘になる）。
  await expect(tabs).toHaveCount(2);
  await expect(claudePane).toHaveClass(/is-active/);
});
