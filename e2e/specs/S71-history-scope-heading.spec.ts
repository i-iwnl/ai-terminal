import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/harness';

/**
 * Issue #20 PR 13-a'。
 *
 * 履歴パネルの見出しは `履歴` で、タブの `履歴` と同じ語を繰り返すだけだった。
 * 一方で「いまどの範囲のセッションを見ているのか」（現在のフォルダに絞り込み中か、
 * すべてのフォルダを横断中か）は画面のどこにも常設されておらず、絞り込みを
 * 外している間だけ出る `.history-list__scope-note` にしか手がかりが無かった。
 *
 * この見出しの文字列を引く spec は1本も無く、`履歴` から何に変えてもフル実行が
 * green のまま main に入る状態だった（S40 / S70 と同じ穴）。
 *
 * ここで固定するのは、見出しが「何のパネルか」ではなく「いまどの範囲を見ているか」を
 * 言うこと。範囲を言う語なので、件数が0になっても文言は変わらない。見出しの要素
 * そのものは <h2> のまま残す（廃すと履歴パネルの見出しが0個になり、VoiceOver の
 * rotor から消える）。
 *
 * allFolders への唯一の入口は0件時の「すべてのフォルダを見る」ボタンなので、
 * S65 と同じく home 直下（履歴フィクスチャが無い）へ cd してから切り替える。
 *
 * **Issue #119 周3 で2つ変わった。**
 *
 * 1. クラスが `.history-list__heading` から `.panel-scope` になった。3パネル
 *    （タスク / 履歴 / メモ）が同じ位置・同じ見た目で「範囲」を言うようにしたため
 *    （#20 の I-2）。パネル内の区切り（`.task-group__heading`）とは意図的に
 *    見た目を変えてある（test/unit/css-tokens.test.ts が両者の差を固定している）。
 * 2. 文言にプロバイダが入った。すぐ下のツールバーに Claude / Gemini のトグルが
 *    見えているのに、見出しは範囲しか言っていなかった。
 */
test('S71 履歴パネルの見出しが、件数ではなくいま見ている範囲を示す', async () => {
  const launched = await launchApp();
  try {
    const { window, home } = launched;

    const screen = window.locator('.terminal-pane__container .xterm-screen').first();
    await expect(screen).toContainText(/[$%#>]/, { timeout: 20_000 });

    await window.locator('.sidebar__tabs button', { hasText: '履歴' }).click();

    const heading = window.locator('.history-list .panel-scope');
    const items = window.locator('.history-item');

    // --- 絞り込み中（既定） ---------------------------------------------------
    await expect(items).toHaveCount(3);
    await expect(heading).toHaveText('このフォルダの Claude');
    // 見出しの要素そのものが残っていること（h2 を廃すと履歴パネルの見出しが0個になる）。
    await expect(heading).toHaveJSProperty('tagName', 'H2');

    // --- 0件になっても、見出しは範囲を言い続ける -------------------------------
    // home 直下には対応する ~/.claude/projects/<encoded>/ が無いので確実に0件になる。
    await window.locator('.xterm-helper-textarea').first().focus();
    await window.keyboard.type(`cd ${home}`);
    await window.keyboard.press('Enter');

    // cwd 追従は2秒間隔のポーリングなので余裕を持たせる。
    await expect(items).toHaveCount(0, { timeout: 15_000 });
    await expect(heading).toHaveText('このフォルダの Claude');

    // --- すべてのフォルダへ切り替えると見出しも変わる ---------------------------
    await window.locator('.history-list .panel-empty__action').click();
    // workDir（3件）+ otherWorkDir（1件）= 4件。
    await expect(items).toHaveCount(4, { timeout: 15_000 });
    await expect(heading).toHaveText('すべてのフォルダの Claude');

    // --- 絞り込みに戻すと見出しも戻る -----------------------------------------
    await window.locator('.history-list__scope-note button').click();
    await expect(items).toHaveCount(0, { timeout: 15_000 });
    await expect(heading).toHaveText('このフォルダの Claude');
  } finally {
    await closeApp(launched);
  }
});
