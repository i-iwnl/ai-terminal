import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/harness';

/**
 * Issue #20 I-3。
 *
 * 履歴0件のときの旧文言「履歴はありません」は、何を入れれば出るのかを
 * 一切教えなかった。実パスを併記し、「すべてのフォルダを見る」ボタンで
 * ~/.claude/projects 配下を横断した集計（reader.ts の listAllClaudeHistory）に
 * 切り替えられるようにする。
 *
 * home 直下（harness.ts の tmpdir 直下）には対応する
 * ~/.claude/projects/<encoded>/ ディレクトリが存在しないため、確実に0件になる。
 * シェルタブでそこへ cd してから履歴タブを見る。
 *
 * gemini はこの機能に対応していない（--list-sessions の実行 cwd 自体がスコープを
 * 決めており、横断すべきディレクトリを列挙する手段が無いため）。偽 gemini CLI は
 * cwd に関わらず同じ固定フィクスチャを返すため、cd による空状態の再現ができない。
 * そこで `geminiEmpty` オプション（--list-sessions が実際に0件を返す）で
 * gemini 側の空状態を作り、「すべてのフォルダを見る」ボタン自体が出ないことを見る。
 */
test('S65 履歴が0件のとき実パスと「すべてのフォルダを見る」が表示され、押すと他フォルダのセッションが見える', async () => {
  const launched = await launchApp({ geminiEmpty: true });
  try {
    const { window, home } = launched;

    const screen = window.locator('.terminal-pane__container .xterm-screen').first();
    await expect(screen).toContainText(/[$%#>]/, { timeout: 20_000 });

    // home 直下（履歴フィクスチャが存在しないディレクトリ）へ cd する。
    await window.locator('.xterm-helper-textarea').first().focus();
    await window.keyboard.type(`cd ${home}`);
    await window.keyboard.press('Enter');

    await window.locator('.sidebar__tabs button', { hasText: '履歴' }).click();
    const items = window.locator('.history-item');

    // cwd 追従は2秒間隔のポーリングなので余裕を持たせる。
    await expect(items).toHaveCount(0, { timeout: 15_000 });
    const empty = window.locator('.history-list .panel-empty');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('このフォルダには過去のセッションがありません');
    // 実パスが併記されていること。
    await expect(empty.locator('.panel-empty__path')).toContainText(home);

    const allFoldersButton = empty.locator('.panel-empty__action');
    await expect(allFoldersButton).toBeVisible();
    await expect(allFoldersButton).toContainText('すべてのフォルダを見る');
    await allFoldersButton.click();

    // workDir（3件）+ otherWorkDir（1件）= 4件が横断して見えること。
    await expect(items).toHaveCount(4, { timeout: 15_000 });
    await expect(window.locator('.history-list__scope-note')).toBeVisible();
    await expect(window.locator('.history-list__scope-note')).toContainText(
      'すべてのフォルダを表示中',
    );

    // 「現在のフォルダのみに戻す」で元のスコープに戻ること。
    await window.locator('.history-list__scope-note button').click();
    await expect(items).toHaveCount(0, { timeout: 15_000 });
    await expect(window.locator('.history-list .panel-empty')).toBeVisible();
    await expect(window.locator('.history-list__scope-note')).toHaveCount(0);

    // gemini に切り替えると、実際に0件（geminiEmpty）でも
    // 「すべてのフォルダを見る」ボタンは出ないこと（本質的な確認）。
    await window.locator('.history-list__providers button', { hasText: 'Gemini' }).click();
    await expect(window.locator('.history-list .panel-empty')).toBeVisible({ timeout: 15_000 });
    await expect(window.locator('.history-list .panel-empty__action')).toHaveCount(0);
  } finally {
    await closeApp(launched);
  }
});
