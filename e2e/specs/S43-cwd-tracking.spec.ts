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
 * cwd 追従（Issue #58）。シェルタブで `cd` すると、実プロセスの cwd を
 * 2秒間隔のポーリング（tabs/useTabs.ts の CWD_POLL_INTERVAL_MS）で問い合わせ直し、
 * アプリ全体の「アクティブな cwd」が更新される。それを購読するサイドバーの
 * 履歴一覧（HistoryList.tsx）が、cd 先の履歴に切り替わることを見る。
 *
 * 追従はシェル側に何も仕込まない。OSC 7（cwd 通知のエスケープシーケンス）は
 * macOS 既定の zsh が出さないため採用せず、代わりに OS へプロセスの cwd を
 * 直接問い合わせる（lsof -a -d cwd -p <pid> -Fn、src/main/pty/cwd.ts）。
 * PTY の出力を横取りして解釈する必要が無い（CLAUDE.md の鉄則2に触れない）ぶん、
 * ポーリング間隔（最大2秒）だけ検知が遅れるトレードオフがある。
 *
 * harness.ts の otherWorkDir に、workDir（起動時の既定 cwd）側の3件とは
 * タイトルが明確に異なる履歴を1件だけ用意してある。
 *
 * **「1件になった」だけを見ない。** どちらの履歴が出ているかまで確認する。
 * cd の追従が逆向き（cd 前の cwd のまま固定）に壊れていても、フィクスチャの
 * 件数だけを見る検証では気づけない。移動前の履歴が一覧から消えることも
 * 合わせて確認する。
 */
test('S43 シェルタブで cd すると、履歴一覧が移動先のものに切り替わる', async () => {
  const { window, otherWorkDir } = launched;

  const beforeTitle = 'サイドバーのレイアウト修正';
  const afterTitle = '別プロジェクトのログ集計バッチ修正';

  // シェルのプロンプトが出るまで待ってから cd を打つ（S03 と同じ前提）。
  const screen = window.locator('.terminal-pane__container .xterm-screen').first();
  await expect(screen).toContainText(/[$%#>]/, { timeout: 20_000 });

  // 履歴タブを開き、既定の作業ディレクトリ（workDir）の履歴が出ていることを確認する。
  await window.locator('.sidebar__tabs button', { hasText: '履歴' }).click();
  const items = window.locator('.history-item');
  await expect(items).toHaveCount(3);
  await expect(window.locator('.history-list')).toContainText(beforeTitle);
  await expect(window.locator('.history-list')).not.toContainText(afterTitle);

  // シェルタブで otherWorkDir へ cd する。
  await window.locator('.xterm-helper-textarea').first().focus();
  await window.keyboard.type(`cd ${otherWorkDir}`);
  await window.keyboard.press('Enter');

  // 追従は2秒間隔のポーリングで駆動するので、待ち時間には余裕を持たせる。
  // 履歴一覧が otherWorkDir 側の1件（別プロジェクトのログ集計バッチ修正）に
  // 切り替わり、workDir 側の履歴（サイドバーのレイアウト修正）は消えること。
  await expect(items).toHaveCount(1, { timeout: 15_000 });
  await expect(items.first()).toContainText(afterTitle);
  await expect(window.locator('.history-list')).not.toContainText(beforeTitle);
});
