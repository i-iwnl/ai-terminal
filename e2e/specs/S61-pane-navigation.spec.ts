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
 * Issue #56 PR 8: ペイン間の移動（design-review.md 提案 B'）。
 *
 * `tabs/paneTree.ts` の `nextPane` / `previousPane` / `movePaneInDirection`
 * （純粋関数。既に test/unit/pane-tree.test.ts が網羅的に固定済み）を、
 * 実際のキー入力（`Cmd+]` / `Cmd+[` / `Cmd+Option+矢印`）から呼べることを
 * 実測で固定する。**アルゴリズムそのものの再検証はしない**（unit の役目）。
 * ここで見るのは配線: キーを押すと `.terminal-pane.is-active` が実際に動くこと。
 *
 * `Cmd+Option+矢印` は U1（design-review.md）でガードが緩んだことに依存する。
 * ガード自体は `renderer-lib.test.ts` の `passesModifierGate` describe が
 * 固定しているが、**実際にこのキーでアプリの動作が変わること**はここでしか
 * 確認できない。
 */
test('S61 Cmd+] / Cmd+[ と Cmd+Option+矢印 でペイン間をフォーカス移動できる', async () => {
  const { window, workDir } = launched;
  const cwdName = workDir.split('/').pop() as string;
  const promptPattern = new RegExp(`${escapeRegExp(cwdName)}\\s*[%#]`);

  const leftPane = window.locator('.pane-split__cell').first().locator('.terminal-pane');
  const rightPane = window.locator('.pane-split__cell').last().locator('.terminal-pane');

  await expect(window.locator('.terminal-pane.is-active .xterm-screen')).toContainText(promptPattern, {
    timeout: 20_000,
  });

  // --- 2ペインに分割する（左右分割 = Cmd+D） ----------------------------------
  await window.keyboard.press('Meta+d');
  await expect(window.locator('.terminal-pane')).toHaveCount(2);
  // 分割直後は新しくできた右側がアクティブ（useTabs.ts の splitActivePane）。
  await expect(rightPane).toHaveClass(/is-active/);
  await expect(leftPane).not.toHaveClass(/is-active/);

  // --- Cmd+]: 次のペイン。2ペインでは唯一の相手（左）へ折り返す ----------------
  await window.keyboard.press('Meta+]');
  await expect(leftPane).toHaveClass(/is-active/);
  await expect(rightPane).not.toHaveClass(/is-active/);

  // もう一度押すと右へ戻る（flattenPaneTree の順で末尾 -> 先頭へ折り返す。
  // 2ペインなので実質トグル）。
  await window.keyboard.press('Meta+]');
  await expect(rightPane).toHaveClass(/is-active/);

  // --- Cmd+[: 前のペイン。右から前は左 ----------------------------------------
  await window.keyboard.press('Meta+[');
  await expect(leftPane).toHaveClass(/is-active/);

  // --- Cmd+Option+矢印: 空間的な方向移動 --------------------------------------
  // いま左がアクティブ。右方向には右ペインがあるので移動する。
  await window.keyboard.press('Meta+Alt+ArrowRight');
  await expect(rightPane).toHaveClass(/is-active/);
  await expect(leftPane).not.toHaveClass(/is-active/);

  await window.keyboard.press('Meta+Alt+ArrowLeft');
  await expect(leftPane).toHaveClass(/is-active/);

  // 端では移動先が無いため、同じペインに留まる（折り返さない。
  // movePaneInDirection の unit test と同じ仕様をキー入力側で確認する）。
  await window.keyboard.press('Meta+Alt+ArrowLeft');
  await expect(leftPane).toHaveClass(/is-active/);
  await expect(rightPane).not.toHaveClass(/is-active/);

  // --- メニュー経由でも同じ操作が呼べること -----------------------------------
  expect(await clickMenuItem(launched.app, '右のペインへ移動')).toBe(true);
  await expect(rightPane).toHaveClass(/is-active/);
  expect(await clickMenuItem(launched.app, '左のペインへ移動')).toBe(true);
  await expect(leftPane).toHaveClass(/is-active/);

  // --- 次/前のペインもメニューに載っていること ---------------------------------
  // Issue 本文の表は「次 / 前のペイン | Cmd+] / Cmd+[ を第一に、
  // Cmd+Option+矢印 を併設（4方向 = 4項目） | 表示」で、「メニュー」列は
  // 行全体に掛かる。「4方向 = 4項目」は Cmd+Option+矢印 側の注記であって、
  // 「第一」と明記された Cmd+] / Cmd+[ をメニューから外す指示ではない。
  // ここが欠けると Issue #22（ショートカットがメニューに1つも載っておらず
  // 発見できない）の再発になる。
  const menuItems = await launched.app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu();
    if (!menu) return [];
    const out: Array<{ label: string; accelerator?: string }> = [];
    const walk = (items: Electron.MenuItem[]): void => {
      for (const item of items) {
        out.push({ label: item.label, accelerator: item.accelerator });
        if (item.submenu) walk(item.submenu.items);
      }
    };
    walk(menu.items);
    return out;
  });
  const byLabel = new Map(menuItems.map((i) => [i.label, i]));
  expect(byLabel.get('次のペインへ')?.accelerator).toBe('Cmd+]');
  expect(byLabel.get('前のペインへ')?.accelerator).toBe('Cmd+[');

  // 実際にメニューから呼べること（いま左がアクティブ。2ペインなので
  // 次/前は実質トグル）。
  expect(await clickMenuItem(launched.app, '次のペインへ')).toBe(true);
  await expect(rightPane).toHaveClass(/is-active/);
  expect(await clickMenuItem(launched.app, '前のペインへ')).toBe(true);
  await expect(leftPane).toHaveClass(/is-active/);
});
