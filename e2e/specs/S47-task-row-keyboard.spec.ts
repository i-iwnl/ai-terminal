import { mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { launchApp, closeApp, encodeProjectDir, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

/**
 * Issue #64: タスク一覧の行が `<li onClick>` のままで `tabindex` も `role` も無く、
 * キーボードだけでは実行中セッションのタブへ飛べなかった（WCAG 2.1.1 違反）。
 *
 * このシナリオが検証したいのは「押せる行（clickable な行）に Tab で到達でき、
 * Enter/Space で対応するタブにフォーカスが移ること」。
 *
 * ## なぜ resume を経由するか
 *
 * 押せる行になる条件は `task.ownedByApp && canFocus(sessionId)`。
 * `ownedByApp` は Main 側の `markOwnedSession`（poller.ts）が「このアプリが
 * --session-id / --resume で起動したセッション ID」の集合に入っているかで決まる。
 *
 * 偽 claude の `agents --json` はハーネスが固定した agents.json をそのまま返す
 * （sessionId は固定値 aaaaaaaa-... / bbbbbbbb-...）。S15 が確認した通り、
 * この2件をアプリ側から「起動した」ことにする経路は無い ---
 * ただし唯一の例外が **resume**。`buildClaudePlan`（pty/manager.ts）は resume のとき
 * `agentSessionId` に `req.resumeSessionId`（= 履歴側の既存 sessionId）をそのまま
 * 使うため、**履歴フィクスチャの sessionId を agents.json の固定値と一致させておけば**、
 * その履歴を resume した瞬間に markOwnedSession が同じ ID を登録し、
 * 一覧側の対応する行が ownedByApp=true になる。
 *
 * この一致は harness.ts の共有フィクスチャではなく、この spec だけが使う
 * 一時 HOME に直接 1 ファイル追記する（他の spec の履歴件数に影響させないため）。
 */
test('S47 キーボードだけでタスク一覧の押せる行に到達し、対応するタブにフォーカスが移る', async () => {
  const { window, home, workDir } = launched;

  // agents.json の demo-project-busy（sessionId: aaaaaaaa-...）と同じ ID を持つ
  // 履歴エントリを追加する。resume するとこの ID で markOwnedSession が呼ばれ、
  // 一覧側の demo-project-busy 行が ownedByApp=true になる。
  const ownedSessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const title = 'キーボードで到達できるはずのセッション';
  const projectDir = join(home, '.claude', 'projects', encodeProjectDir(workDir));
  mkdirSync(projectDir, { recursive: true });
  const historyFile = join(projectDir, `${ownedSessionId}.jsonl`);
  const jsonl = [
    JSON.stringify({
      type: 'mode',
      sessionId: ownedSessionId,
      cwd: workDir,
      timestamp: '2026-07-28T10:00:00.000Z',
    }),
    JSON.stringify({
      type: 'user',
      sessionId: ownedSessionId,
      cwd: workDir,
      gitBranch: 'main',
      timestamp: '2026-07-28T10:00:01.000Z',
      message: { role: 'user', content: 'キーボード到達性を直したい' },
    }),
    JSON.stringify({
      type: 'ai-title',
      sessionId: ownedSessionId,
      aiTitle: title,
      timestamp: '2026-07-28T10:00:02.000Z',
    }),
  ].join('\n');
  writeFileSync(historyFile, `${jsonl}\n`);
  // 一覧は更新時刻の降順。既存3件より新しくして見つけやすくする。
  const when = new Date(Date.UTC(2026, 6, 28, 10, 0, 0));
  utimesSync(historyFile, when, when);

  // シェルタブが起動しきるまで待つ（他 spec と同じ理由。ショートカットの取りこぼし対策）。
  const initialScreen = window.locator('.terminal-pane__container .xterm-screen').first();
  await expect(initialScreen).toContainText(/[$%#>]/, { timeout: 20_000, useInnerText: true });

  // 履歴一覧から resume する。
  await window.locator('.sidebar__tabs button', { hasText: '履歴' }).click();
  const historyItem = window.locator('.history-item', { hasText: title });
  await expect(historyItem).toHaveCount(1, { timeout: 15_000 });
  await historyItem.click();

  // resume で新しいタブが開き、そのままアクティブになる。
  const resumedTab = window.locator('.tab-bar__tab', { hasText: title });
  await expect(resumedTab).toHaveClass(/is-active/, { timeout: 15_000 });
  const resumedScreen = window.locator('.terminal-pane__container .xterm-screen').last();
  await expect(resumedScreen).toContainText('FAKE CLAUDE READY', { timeout: 20_000 });
  await expect(resumedScreen).toContainText(ownedSessionId, { timeout: 20_000 });

  // 最初のシェルタブへ戻す。resume したタブを非アクティブにしておかないと、
  // 一覧の行から「同じタブへ focus」してもフォーカス移動が観測できない
  // （既にアクティブなタブは active プロパティが変化せず、handle.focus() が再発火しない）。
  await window.locator('.tab-bar__tab').first().click();
  await expect(resumedTab).not.toHaveClass(/is-active/);

  // タスク一覧へ切り替える。ポーリングが resume 済みの ownedByApp を拾うまで待つ。
  await window.locator('.sidebar__tabs button', { hasText: 'タスク' }).click();
  const ownedItem = window.locator('.task-item--owned');
  await expect(ownedItem).toHaveCount(1, { timeout: 15_000 });
  await expect(ownedItem.locator('.task-item__name')).toContainText('demo-project-busy');

  // 押せる行は <button>、押せない行（other-project-idle。owned ではない）は
  // 依然として非対話のままであること（Tab で止まって何も起きない行を作らない）。
  const clickableRow = window.locator('.task-item--owned .task-item__row');
  await expect(clickableRow).toHaveCount(1);
  expect(await clickableRow.evaluate((el) => el.tagName)).toBe('BUTTON');

  const otherRow = window.locator('.task-item:not(.task-item--owned) .task-item__row');
  await expect(otherRow).toHaveCount(1);
  expect(await otherRow.evaluate((el) => el.tagName)).toBe('DIV');

  // ここからが本題: マウスを一切使わず、Tab だけで押せる行に到達する。
  // 「タスク」サイドバータブのボタンを起点にする（クリックは起点合わせの
  // セットアップであり、そこから先は Tab キーだけで進む）。
  await window.locator('.sidebar__tabs button', { hasText: 'タスク' }).focus();

  let reached = false;
  for (let i = 0; i < 15 && !reached; i++) {
    await window.keyboard.press('Tab');
    reached = await clickableRow
      .evaluate((el) => el === document.activeElement)
      .catch(() => false);
  }
  // 修正前（<li onClick> のまま）は、この行がそもそもフォーカス可能でないため
  // Tab を何回押してもここに到達できず reached が false のまま残る。
  expect(reached, 'Tab だけでタスク一覧の押せる行に到達できること').toBe(true);

  // Enter で対応するタブにフォーカスが移ること。
  await window.keyboard.press('Enter');

  await expect(resumedTab).toHaveClass(/is-active/, { timeout: 15_000 });
  // setActiveTabId が呼ばれるだけでなく、実際にキーボードフォーカスが
  // 対応するターミナル（xterm の隠し textarea）へ移っていること。
  await expect(resumedScreen.locator('.xterm-helper-textarea')).toBeFocused({ timeout: 15_000 });
});
