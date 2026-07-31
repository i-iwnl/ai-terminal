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

async function clickMenuItem(app: LaunchedApp['app'], label: string): Promise<boolean> {
  return app.evaluate(({ Menu }, targetLabel) => {
    const menu = Menu.getApplicationMenu();
    if (!menu) return false;
    let target: Electron.MenuItem | undefined;
    const walk = (items: Electron.MenuItem[]): void => {
      for (const item of items) {
        if (item.label === targetLabel) target = item;
        if (item.submenu) walk(item.submenu.items);
      }
    };
    walk(menu.items);
    if (!target?.click) return false;
    target.click();
    return true;
  }, label);
}

/**
 * Issue #56 PR 8: ペインの最大化トグル（design-review.md 提案 I）。
 *
 * `Cmd+Shift+Enter` で、アクティブなペインだけを一時的に画面いっぱいに広げ、
 * もう一方は視覚的に消える。**「一時的な表示の切り替えであって木の変形では
 * ない」**ことが要件で、PTY を kill してはいけない。
 *
 * PTY が生きたままであることは、間接的だが実際の挙動で確かめる: 最大化の
 * 前後・最中にそれぞれ固有の目印文字列を出力し、トグルを2回（最大化 -> 解除）
 * 挟んでも両方の目印がスクロールバックに残っていることを見る。PTY が
 * kill されて再起動していれば、目印は消えて新しい起動直後のシェルに
 * 置き換わるはずなので、これが「kill していない」ことの実測になる。
 *
 * **`.terminal-pane.is-active` を対象の固定ハンドルにしない。** このペインの
 * `.xterm-helper-textarea` を `.focus()` した瞬間に `onFocusCapture` が
 * 発火して「アクティブなペイン」自体が入れ替わるため、`:not(.is-active)`
 * 等の動的なロケータを使うと、操作の途中で参照先がもう一方のペインに
 * すり替わる（実際にこの実装ミスで最初の実測が失敗した）。S59/S61 と同じ
 * DOM 位置ベース（`.pane-split__cell` の並び順）の `leftPane` / `rightPane`
 * を安定ハンドルにする。
 */
test('S60 Cmd+Shift+Enter でペインの最大化をトグルでき、PTYを再起動せず表示だけが切り替わる', async () => {
  const { window, workDir } = launched;
  const cwdName = workDir.split('/').pop() as string;
  const promptPattern = new RegExp(`${escapeRegExp(cwdName)}\\s*[%#]`);

  const panes = window.locator('.terminal-pane');
  const splitter = window.locator('.pane-splitter');

  await expect(panes).toHaveCount(1);
  await expect(window.locator('.terminal-pane.is-active .xterm-screen')).toContainText(promptPattern, {
    timeout: 20_000,
  });

  // --- 分割して2ペインにする（左右分割 = Cmd+D） -------------------------------
  await window.keyboard.press('Meta+d');
  await expect(panes).toHaveCount(2);

  // DOM 位置ベースの安定ハンドル（PaneTreeView.tsx は children[0] -> スプリッタ
  // -> children[1] の順で描画するため、常に「左」「右」を指す）。
  const leftPane = window.locator('.pane-split__cell').first().locator('.terminal-pane');
  const rightPane = window.locator('.pane-split__cell').last().locator('.terminal-pane');

  // 分割直後は新しくできた右側がアクティブ（useTabs.ts の splitActivePane）。
  await expect(rightPane).toHaveClass(/is-active/);
  await expect(leftPane).not.toHaveClass(/is-active/);
  await expect(rightPane.locator('.xterm-screen')).toContainText(promptPattern, { timeout: 20_000 });

  // 両方のペインへ別々の目印を出しておく。
  await leftPane.locator('.xterm-helper-textarea').focus();
  await window.keyboard.type('echo LEFT-PANE-MARKER');
  await window.keyboard.press('Enter');
  await expect(leftPane.locator('.xterm-screen')).toContainText('LEFT-PANE-MARKER', { timeout: 10_000 });
  // 左を focus() した時点で左がアクティブになっているはず（クリックと同じ経路）。
  await expect(leftPane).toHaveClass(/is-active/);

  await rightPane.locator('.xterm-helper-textarea').focus();
  await window.keyboard.type('echo RIGHT-PANE-MARKER');
  await window.keyboard.press('Enter');
  await expect(rightPane.locator('.xterm-screen')).toContainText('RIGHT-PANE-MARKER', { timeout: 10_000 });
  await expect(rightPane).toHaveClass(/is-active/);

  // --- Cmd+Shift+Enter: 最大化 ------------------------------------------------
  // 今アクティブなのは右側。
  await window.keyboard.press('Meta+Shift+Enter');

  // アクティブなペイン（右）だけが実際に見える状態になる（左・スプリッタは
  // 視覚的に消える。マウント自体は維持されたまま = PTY を kill しない）。
  await expect(rightPane).toBeVisible();
  await expect(leftPane).toBeHidden();
  await expect(splitter).toBeHidden();

  // 最大化中もその場でタイプでき、独立した PTY のまま入力を受け付ける
  // （最大化してもフォーカスは動かしていないので、そのままタイプできる）。
  await window.keyboard.type('echo MAXIMIZED-STILL-WORKS');
  await window.keyboard.press('Enter');
  await expect(rightPane.locator('.xterm-screen')).toContainText('MAXIMIZED-STILL-WORKS', {
    timeout: 10_000,
  });

  // --- Cmd+Shift+Enter: 最大化解除 --------------------------------------------
  await window.keyboard.press('Meta+Shift+Enter');
  await expect(rightPane).toBeVisible();
  await expect(leftPane).toBeVisible();
  await expect(splitter).toBeVisible();

  // PTY が生きたままだったことの実測: 最大化の前後・最中に出した3つの目印が
  // すべてスクロールバックに残っている（kill されていれば消えて、新しい
  // 起動直後のシェルに置き換わっているはず）。
  await expect(rightPane.locator('.xterm-screen')).toContainText('RIGHT-PANE-MARKER');
  await expect(rightPane.locator('.xterm-screen')).toContainText('MAXIMIZED-STILL-WORKS');
  await expect(leftPane.locator('.xterm-screen')).toContainText('LEFT-PANE-MARKER');
  // 最大化中に打った文字が、隠れていた左ペインへ誤って漏れていないこと。
  await expect(leftPane.locator('.xterm-screen')).not.toContainText('MAXIMIZED-STILL-WORKS');

  // --- メニュー経由でも同じ操作が呼べること -----------------------------------
  expect(await clickMenuItem(launched.app, 'ペインを最大化')).toBe(true);
  await expect(leftPane).toBeHidden();
  expect(await clickMenuItem(launched.app, 'ペインを最大化')).toBe(true);
  await expect(leftPane).toBeVisible();
});
